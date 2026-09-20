import { sql } from "../../std/sql_utils";
import type { NumericExpr, Sql } from "../../std/sql_utils";
import type {
  GeneralServerStatements,
  IServerBaseStatements,
} from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";

interface OutgoingWebhookRequestOpts {
  txId: NumericExpr;
  recordId: NumericExpr;
  url: Sql;
  extraData: Sql;
}

export interface OutgoingWebhookType {
  name: string;
  renameFrom?: string;
  makeRequest: (
    s: GeneralServerStatements,
    opts: OutgoingWebhookRequestOpts,
  ) => void;
  sendTestRequest?: <T extends IServerBaseStatements>(
    s: T,
    opts: { url: Sql },
  ) => void;
}

interface OutgoingWebhooksOpts {
  types?: OutgoingWebhookType[];
}

interface MakeRequestOpts {
  invocationId: NumericExpr;
  type: OutgoingWebhookType;
  opts: OutgoingWebhookRequestOpts;
}

function makeRequest(
  s: GeneralServerStatements,
  { invocationId, type, opts }: MakeRequestOpts,
) {
  s.try({
    body: (s) => {
      type.makeRequest(s, opts);
      s.startTransaction();
      s.modify(
        sql`insert into outgoing_webhook_attempts
        (outgoing_webhook_invocation_id, status_code, failure_reason) values
        (${invocationId}, response.status, null)`,
      );
      s.defScalar(
        "new_status",
        sql`cast(case
          when response.status in (200, 201, 204) then 'succeeded'
          when (select count(*) from outgoing_webhook_attempts where outgoing_webhook_invocation_id = ${invocationId}) >= 5 then 'failed'
          else 'in_progress'
        end as enums.outgoing_webhook_status)`,
      );
      s.modify(
        sql`update outgoing_webhook_invocations set status = new_status where id = ${invocationId}`,
      );
      s.commitTransaction();
    },
    errorName: "error",
    catch: (s) => {
      s.startTransaction();
      s.modify(
        sql`insert into outgoing_webhook_attempts
        (outgoing_webhook_invocation_id, status_code, failure_reason) values
        (${invocationId}, null, concat(error.type, ': ', coalesce(error.message, '')))`,
      );
      s.defScalar(
        "new_status",
        sql`cast(case
          when (select count(*) from outgoing_webhook_attempts where outgoing_webhook_invocation_id = ${invocationId}) >= 5 then 'failed'
          else 'in_progress'
        end as enums.outgoing_webhook_status)`,
      );
      s.modify(
        sql`update outgoing_webhook_invocations set status = new_status where id = ${invocationId}`,
      );
      s.commitTransaction();
    },
  });
}

/**
 * Solution block that gives users a UI for sending outgoing webhooks
 * with retries, history, and per-type configuration. Define the
 * available webhook types in `opts.types`; admins can then configure
 * endpoints and the block reacts to inserts in
 * `outgoing_webhook_invocations` by dispatching the requests.
 *
 * Add to `core.tsx`:
 *
 * ```ts
 * system.addBlock(new OutgoingWebhooksBlock({
 *   types: [{ name: "contact_created", ... }],
 * }));
 * ```
 */
export class OutgoingWebhooksBlock implements Block {
  /** Configured webhook types (events users can subscribe to). */
  types: OutgoingWebhookType[] = [];
  blockName = "OutgoingWebhooksBlock";
  blockDisplayName = "Outgoing Webhooks";
  externalServiceOptions = [
    {
      optionKey: "send_webhooks",
      optionLabel: "Send outgoing webhook requests",
    },
  ];
  componentDependencies: string[] = [];
  description: string | undefined;
  /** Page component for the user-facing webhook management UI. */
  static WebhookManagementPage: any;
  constructor(opts: OutgoingWebhooksOpts = {}) {
    this.types = opts.types ?? [];
  }

  initialize() {
    const { db } = system;

    system.enum_({
      name: "outgoing_webhook_type",
      values: this.types.map((t) => t.name),
    });

    system.enum_({
      name: "outgoing_webhook_status",
      values: ["pending", "in_progress", "succeeded", "failed"],
    });

    db.table("outgoing_webhooks", (table) => {
      table.string("name", 200).notNull();
      table.string("description", 1000);
      table.string("url", 2000).notNull();
      table.enum("type", "outgoing_webhook_type").notNull();
    });

    db.table("outgoing_webhook_invocations", (table) => {
      table.fk("outgoing_webhooks").notNull();
      table.bigUint("record_id").notNull();
      table.json("extra_data");
      table.enum("status", "outgoing_webhook_status").notNull();
      table.virtual(
        "attempt_count",
        sql`(select count(*) from outgoing_webhook_attempts where outgoing_webhook_invocation_id = outgoing_webhook_invocations.id)`,
      );
      table.virtual(
        "last_attempt_timestamp",
        sql`(select max(attempted_at)
        from outgoing_webhook_attempts
        where outgoing_webhook_invocation_id = outgoing_webhook_invocations.id)`,
      );
      const INITIAL_RETRY_DELAY = 60;
      const BACKOFF_FACTOR = 2.0;
      // three days
      const MAX_RETRY_DELAY = 3600 * 24 * 3;
      table.virtual(
        "next_retry_at",
        sql`case
        when attempt_count = 0 then created_at
        else date.add(
          second,
          least(
            ((${INITIAL_RETRY_DELAY}::real) * power(${BACKOFF_FACTOR}::real, attempt_count + 1) * (0.5::real + random.real() / 2))::int,
            ${MAX_RETRY_DELAY}
          ),
          last_attempt_timestamp
        )
      end`,
      );
    });
    db.table("outgoing_webhook_attempts", (table) => {
      table
        .fk("outgoing_webhook_invocation_id", "outgoing_webhook_invocations")
        .notNull();
      table.smallUint("status_code");
      table.string("failure_reason", 1000);
      table.timestampUtc("attempted_at").notNull().default(sql`now()`);
    });
    this.componentDependencies = ["OutgoingWebhooksPage"];
    this.description =
      "Provides a way to send outgoing webhooks to external services.";
  }

  addType(type: OutgoingWebhookType) {
    this.types.push(type);
    system.addVariantToEnum("outgoing_webhook_type", {
      name: type.name,
      renameFrom: type.renameFrom,
    });
  }

  addTypeIfNotExists(type: OutgoingWebhookType) {
    if (this.types.find((t) => t.name === type.name)) {
      return;
    }
    this.addType(type);
  }

  trigger<T extends IServerBaseStatements>(
    s: T,
    opts: {
      type: string;
      recordId: NumericExpr;
      extraData?: Sql;
    },
  ) {
    s.forEachQuery(
      sql`select * from db.outgoing_webhooks where type = ${
        sql.lit(opts.type)
      }`,
      "outgoing_webhook",
      (s) => {
        s.modify(
          sql`insert into outgoing_webhook_invocations (outgoing_webhook_id, record_id, extra_data, status) values
        (outgoing_webhook.id, ${opts.recordId}, ${
            opts.extraData ?? sql.null
          }, 'pending')`,
        );
      },
    );
  }

  populate() {
    const INITIAL_RETRY_DELAY = 60;
    const BACKOFF_FACTOR = 2.0;
    const MAX_RETRY_DELAY = 3600 * 24 * 3;
    system.addReactor({
      name: "outgoing_webhook_integration",
      query: sql`select owi.id from db.outgoing_webhook_invocations owi
        where
          status in ('pending', 'in_progress') and
          (
            not exists (select 1 from db.outgoing_webhook_attempts where outgoing_webhook_invocation_id = owi.id)
            or date.add(
              second,
              least(
                ((${INITIAL_RETRY_DELAY}::real) * power(${BACKOFF_FACTOR}::real, (select count(*) from db.outgoing_webhook_attempts where outgoing_webhook_invocation_id = owi.id) + 1) * (0.5::real + random.real() / 2))::int,
                ${MAX_RETRY_DELAY}
              ),
              (select max(attempted_at) from db.outgoing_webhook_attempts where outgoing_webhook_invocation_id = owi.id)
            ) <= now()
          )`,
      recordName: "outgoing_webhook_invocation",
      maxConcurrent: 128,
      procedure: (s) => {
        s.defRecord(
          "invocation",
          sql`select outgoing_webhook_invocations.*, outgoing_webhooks.type as webhook_type, outgoing_webhooks.url as webhook_url
          from db.outgoing_webhook_invocations
          auto join db.outgoing_webhooks
          where outgoing_webhook_invocations.id = outgoing_webhook_invocation.id`,
        );
        for (const type of this.types) {
          s.if(
            sql`invocation.webhook_type = ${sql.lit(type.name)}`,
            (s) => {
              makeRequest(s, {
                invocationId: sql`invocation.id`,
                type,
                opts: {
                  txId: sql`invocation.created_by_tx`,
                  recordId: sql`invocation.record_id`,
                  url: sql`invocation.webhook_url`,
                  extraData: sql`invocation.extra_data`,
                },
              });
            },
          );
        }
      },
    });
  }
}
