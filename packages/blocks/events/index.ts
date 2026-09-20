import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";

export interface RegisteredEventType {
  name: string;
  displayName?: string;
}

export interface EventsBlockOptions {
  aggregateTypes?: RegisteredEventType[];
  eventTypes?: RegisteredEventType[];
}

export interface EventBindingInput {
  recordType: string;
  recordId: NumericExpr;
  role: string;
}

export interface EmitEventOptions {
  aggregateType: string;
  aggregateId: NumericExpr;
  eventType: string;
  effectiveAt?: Sql;
  actorUserId?: NumericExpr;
  source?: Sql;
  correlationId?: Sql;
  causationEventId?: NumericExpr;
  idempotencyKey?: Sql;
  correctionOfEventId?: NumericExpr;
  summary: Sql;
  payload?: Sql;
  bindings?: EventBindingInput[];
  intoEventId: string;
}

export interface AppendPhysicalTraceOptions {
  eventId: NumericExpr;
  subjectType: string;
  subjectId: NumericExpr;
  eventFamily: string;
  effectiveAt?: Sql;
  fromLocationId?: NumericExpr;
  toLocationId?: NumericExpr;
  fromCustodianUserId?: NumericExpr;
  toCustodianUserId?: NumericExpr;
}

/**
 * Shared SQL event store for typed, domain-owned events.
 *
 * Domains register stable aggregate and event names, then emit through this
 * helper so provenance, bitemporal timestamps, idempotency, corrections, and
 * generic record bindings remain consistent. `physical_trace` is a normalized
 * cross-domain read model; it is not the source of truth for domain behavior.
 */
export class EventsBlock implements Block {
  blockName = "EventsBlock";
  blockDisplayName = "Events";
  componentDependencies: string[] = [];
  description =
    "Typed append-only events, generic record bindings, and a physical trace read model.";

  private readonly aggregateTypes = new Map<string, RegisteredEventType>();
  private readonly eventTypes = new Map<string, RegisteredEventType>();
  private initialized = false;

  constructor(opts: EventsBlockOptions = {}) {
    for (const type of opts.aggregateTypes ?? []) {
      this.aggregateTypes.set(type.name, type);
    }
    for (const type of opts.eventTypes ?? []) {
      this.eventTypes.set(type.name, type);
    }
  }

  initialize() {
    system.enum_({
      name: "event_aggregate_type",
      values: [...this.aggregateTypes.values()],
    });
    system.enum_({
      name: "event_type",
      values: [...this.eventTypes.values()],
    });

    system.db.table("events", (table) => {
      table.enum("aggregate_type", "event_aggregate_type").notNull();
      table.bigUint("aggregate_id").notNull();
      table.enum("event_type", "event_type").notNull();
      table.smallUint("schema_version").notNull().default(sql`1`);
      table.timestampUtc("effective_at").notNull();
      table.timestampUtc("recorded_at").notNull().default(sql`now()`);
      table.fk("actor_user_id", "sys_users").onDelete("SetToNull");
      table.string("source", 100).notNull().default(sql.lit`application`);
      table.uuid("correlation_id").notNull().default(sql`gen_random_uuid()`);
      table.fk("causation_event_id", "events").onDelete("Restrict");
      table.uuid("idempotency_key").unique();
      table.fk("correction_of_event_id", "events").onDelete("Restrict");
      table.string("summary", 1000).notNull();
      table.json("payload").notNull().default(sql`json_build_object()`);
      table.skipAutoApi();
    });

    system.db.table("event_bindings", (table) => {
      table.fk("events").notNull().onDelete("Cascade");
      table.string("record_type", 100).notNull();
      table.bigUint("record_id").notNull();
      table.string("role", 80).notNull();
      table.unique(["event_id", "record_type", "record_id", "role"]);
      table.skipAutoApi();
    });

    system.db.table("physical_trace", (table) => {
      table.fk("events").notNull().unique().onDelete("Cascade");
      table.string("subject_type", 100).notNull();
      table.bigUint("subject_id").notNull();
      table.string("event_family", 80).notNull();
      table.bigUint("from_location_id");
      table.bigUint("to_location_id");
      table.bigUint("from_custodian_user_id");
      table.bigUint("to_custodian_user_id");
      table.timestampUtc("effective_at").notNull();
      table.timestampUtc("recorded_at").notNull().default(sql`now()`);
      table.skipAutoApi();
    });

    this.initialized = true;
  }

  registerAggregateType(type: RegisteredEventType) {
    if (this.aggregateTypes.has(type.name)) return;
    this.aggregateTypes.set(type.name, type);
    if (this.initialized) {
      system.addVariantToEnum("event_aggregate_type", type);
    }
  }

  registerEventType(type: RegisteredEventType) {
    if (this.eventTypes.has(type.name)) return;
    this.eventTypes.set(type.name, type);
    if (this.initialized) {
      system.addVariantToEnum("event_type", type);
    }
  }

  emit<T extends IServerBaseStatements>(s: T, opts: EmitEventOptions) {
    if (!this.aggregateTypes.has(opts.aggregateType)) {
      throw new Error(`Unregistered event aggregate: ${opts.aggregateType}`);
    }
    if (!this.eventTypes.has(opts.eventType)) {
      throw new Error(`Unregistered event type: ${opts.eventType}`);
    }

    s.defScalar(opts.intoEventId, sql`cast(null as bigint)`);
    s.modify(sql`
      insert into db.events (
        aggregate_type,
        aggregate_id,
        event_type,
        effective_at,
        actor_user_id,
        source,
        correlation_id,
        causation_event_id,
        idempotency_key,
        correction_of_event_id,
        summary,
        payload
      ) values (
        ${sql.lit(opts.aggregateType)},
        ${opts.aggregateId},
        ${sql.lit(opts.eventType)},
        ${opts.effectiveAt ?? sql`now()`},
        ${opts.actorUserId ?? sql`null`},
        ${opts.source ?? sql.lit`application`},
        ${opts.correlationId ?? sql`gen_random_uuid()`},
        ${opts.causationEventId ?? sql`null`},
        ${opts.idempotencyKey ?? sql`null`},
        ${opts.correctionOfEventId ?? sql`null`},
        ${opts.summary},
        ${opts.payload ?? sql`json_build_object()`}
      )
      returning id into ${sql.ref(opts.intoEventId)}
    `);

    const bindings = [
      {
        recordType: opts.aggregateType,
        recordId: opts.aggregateId,
        role: "aggregate",
      },
      ...(opts.bindings ?? []),
    ];
    for (const binding of bindings) {
      s.modify(sql`
        insert into db.event_bindings (event_id, record_type, record_id, role)
        values (
          ${sql.ref(opts.intoEventId)},
          ${sql.lit(binding.recordType)},
          ${binding.recordId},
          ${sql.lit(binding.role)}
        )
      `);
    }
  }

  appendPhysicalTrace<T extends IServerBaseStatements>(
    s: T,
    opts: AppendPhysicalTraceOptions,
  ) {
    s.modify(sql`
      insert into db.physical_trace (
        event_id,
        subject_type,
        subject_id,
        event_family,
        from_location_id,
        to_location_id,
        from_custodian_user_id,
        to_custodian_user_id,
        effective_at
      ) values (
        ${opts.eventId},
        ${sql.lit(opts.subjectType)},
        ${opts.subjectId},
        ${sql.lit(opts.eventFamily)},
        ${opts.fromLocationId ?? sql`null`},
        ${opts.toLocationId ?? sql`null`},
        ${opts.fromCustodianUserId ?? sql`null`},
        ${opts.toCustodianUserId ?? sql`null`},
        ${opts.effectiveAt ?? sql`now()`}
      )
    `);
  }

  validate() {
    if (!system.db.tables.sys_users) {
      throw new Error(
        "EventsBlock requires AuthBlock to be initialized first.",
      );
    }
    if (this.aggregateTypes.size === 0) {
      throw new Error("EventsBlock requires at least one aggregate type.");
    }
    if (this.eventTypes.size === 0) {
      throw new Error("EventsBlock requires at least one event type.");
    }
  }
}
