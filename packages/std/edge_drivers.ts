import { sql } from "./sql_utils";
import type { AnyExpr } from "./sql_utils";
import type { IStatementsBase } from "./statements";

export interface EdgeDriverTypeRegistry {
  http_client: {
    config: {
      base_url: string;
      allowed_methods: string[];
      allowed_path_prefixes: string[];
      headers?: Record<string, string>;
      file_roots?: Record<string, string>;
      allow_http?: boolean;
      connect_timeout_ms?: number;
      request_timeout_ms?: number;
      max_request_bytes?: number;
      max_response_bytes?: number;
      max_file_bytes?: number;
      queue_capacity?: number;
    };
    actions: {
      request: {
        params: {
          method: AnyExpr;
          path: AnyExpr;
          body?: AnyExpr;
          body_json?: AnyExpr;
          content_type?: AnyExpr;
        };
      };
      fetch_to_file: {
        params: {
          path: AnyExpr;
          root: AnyExpr;
          destination: AnyExpr;
          expected_blake3?: AnyExpr;
          overwrite?: AnyExpr;
        };
      };
      upload_file: {
        params: {
          method: AnyExpr;
          path: AnyExpr;
          root: AnyExpr;
          source: AnyExpr;
          content_type?: AnyExpr;
        };
      };
    };
    events: {
      response: { durability: "durable" };
      complete: { durability: "durable" };
      error: { durability: "durable" };
    };
  };
  file_system: {
    config: {
      roots: Record<string, string>;
      allowed_operations: Array<
        | "write_file"
        | "read_file"
        | "move"
        | "copy"
        | "delete"
        | "stat"
        | "list"
        | "mkdir"
        | "watch"
      >;
      watches?: Array<{
        name: string;
        root: string;
        path?: string;
        recursive?: boolean;
        include_existing?: boolean;
        extensions?: string[];
        settle_ms?: number;
        poll_interval_ms?: number;
        max_files_per_scan?: number;
        max_hash_bytes?: number;
        max_hashes_per_poll?: number;
        hash_timeout_ms?: number;
      }>;
      max_read_bytes?: number;
      max_write_bytes?: number;
      max_list_entries?: number;
      queue_capacity?: number;
    };
    actions: {
      write_file: {
        params: {
          root: AnyExpr;
          path: AnyExpr;
          content: AnyExpr;
          overwrite?: AnyExpr;
        };
      };
      read_file: {
        params: {
          root: AnyExpr;
          path: AnyExpr;
          mime_type?: AnyExpr;
        };
      };
      move: {
        params: {
          source_root: AnyExpr;
          source_path: AnyExpr;
          destination_root: AnyExpr;
          destination_path: AnyExpr;
          overwrite?: AnyExpr;
        };
      };
      copy: {
        params: {
          source_root: AnyExpr;
          source_path: AnyExpr;
          destination_root: AnyExpr;
          destination_path: AnyExpr;
          overwrite?: AnyExpr;
        };
      };
      delete: {
        params: { root: AnyExpr; path: AnyExpr };
      };
      stat: {
        params: { root: AnyExpr; path: AnyExpr };
      };
      list: {
        params: {
          root: AnyExpr;
          path?: AnyExpr;
          recursive?: AnyExpr;
        };
      };
      mkdir: {
        params: { root: AnyExpr; path: AnyExpr };
      };
    };
    events: {
      complete: { durability: "durable" };
      error: { durability: "durable" };
      file_settled: { durability: "durable" };
    };
  };
  document_printer: {
    config: { printer_name: string; timeout_ms?: number };
    actions: {
      print: {
        params: { content: AnyExpr; job_name?: AnyExpr; copies?: AnyExpr };
      };
    };
    events: {
      complete: { durability: "durable" };
      error: { durability: "durable" };
    };
  };
  raw_printer: {
    config:
      | { transport: "tcp"; host: string; port: number; timeout_ms?: number }
      | {
        transport: "windows_queue";
        printer_name: string;
        timeout_ms?: number;
      };
    actions: { print: { params: { content: AnyExpr; job_name?: AnyExpr } } };
    events: {
      complete: { durability: "durable" };
      error: { durability: "durable" };
    };
  };
}

export interface ExternalEdgeDriverConfig {
  driver_config?: Record<string, unknown>;
  hello_timeout_ms?: number;
  init_timeout_ms?: number;
  dispatch_timeout_ms?: number;
  shutdown_grace_timeout_ms?: number;
}

export type ExternalEdgeDriverType = `external:${string}`;
export type BuiltInEdgeDriverTypeName = keyof EdgeDriverTypeRegistry & string;
export type EdgeDriverTypeName =
  | BuiltInEdgeDriverTypeName
  | ExternalEdgeDriverType;
export type EdgeDriverActionName<TType extends EdgeDriverTypeName> =
  TType extends BuiltInEdgeDriverTypeName
    ? keyof EdgeDriverTypeRegistry[TType]["actions"] & string
    : string;
export type EdgeDriverActionDef<
  TType extends EdgeDriverTypeName,
  TAction extends EdgeDriverActionName<TType>,
> = TType extends BuiltInEdgeDriverTypeName
  ? TAction extends keyof EdgeDriverTypeRegistry[TType]["actions"]
    ? EdgeDriverTypeRegistry[TType]["actions"][TAction]
  : never
  : { params: Record<string, AnyExpr> };
export type EdgeDriverActionParams<
  TType extends EdgeDriverTypeName,
  TAction extends EdgeDriverActionName<TType>,
> = EdgeDriverActionDef<TType, TAction> extends { params: infer TParams }
  ? TParams
  : never;
export type EdgeDriverEventName<TType extends EdgeDriverTypeName> =
  TType extends BuiltInEdgeDriverTypeName
    ? keyof EdgeDriverTypeRegistry[TType]["events"] & string
    : string;
export type EdgeDriverEventDef<
  TType extends EdgeDriverTypeName,
  TEvent extends EdgeDriverEventName<TType>,
> = TType extends BuiltInEdgeDriverTypeName
  ? TEvent extends keyof EdgeDriverTypeRegistry[TType]["events"]
    ? EdgeDriverTypeRegistry[TType]["events"][TEvent]
  : never
  : { durability: "ephemeral" | "durable" };
export type EdgeDriverConfig<TType extends EdgeDriverTypeName> = TType extends
  BuiltInEdgeDriverTypeName ? EdgeDriverTypeRegistry[TType]["config"]
  : ExternalEdgeDriverConfig;

export type EdgeDriverConfigValidator = <T extends IStatementsBase>(
  s: T,
  config: AnyExpr,
  context: string,
) => void;

export type EdgeDriverActionEffect =
  | "read_only"
  | "reversible"
  | "business_effect";

export interface EdgeDriverActionDefinition {
  effect: EdgeDriverActionEffect;
}

export interface EdgeDriverDefinition {
  guidePath: string;
  actions: Record<string, EdgeDriverActionDefinition>;
  validateConfig: EdgeDriverConfigValidator;
  events: Record<string, { durability: "ephemeral" | "durable" }>;
}

type BuiltInEdgeDriverDefinition<TType extends BuiltInEdgeDriverTypeName> = {
  guidePath: string;
  actions: {
    [TAction in EdgeDriverActionName<TType>]: EdgeDriverActionDefinition;
  };
  validateConfig: EdgeDriverConfigValidator;
  events: {
    [TEvent in EdgeDriverEventName<TType>]: EdgeDriverEventDef<
      TType,
      TEvent
    >;
  };
};

function jsonField(config: AnyExpr, key: string) {
  return sql`${config}->${sql.lit(key)}`;
}

function requireJsonObject(
  s: IStatementsBase,
  config: AnyExpr,
  message: string,
) {
  s.throwErrorIf(
    sql`${config} is null or json_typeof(${config}) != 'object'`,
    sql.lit(message),
  );
}

function validateAllowedKeys(
  s: IStatementsBase,
  config: AnyExpr,
  allowedKeys: string[],
  context: string,
) {
  s.block((s) => {
    if (allowedKeys.length === 0) {
      s.throwErrorIf(
        sql`exists(select 1 from json_each(${config}) as entry)`,
        sql`${sql.lit(context)} || ' must be empty'`,
      );
      return;
    }
    const allowedSql = sql(
      allowedKeys.map((key) => sql.lit(key).toSQL()).join(", "),
    );
    s.defScalar(
      "unexpected_key",
      sql`(
        select entry.key
        from json_each(${config}) as entry
        where entry.key not in (${allowedSql})
        limit 1
      )`,
    );
    s.if(sql`unexpected_key is not null`, (s) => {
      s.throwError(
        sql`${
          sql.lit(context)
        } || ' has unknown field "' || unexpected_key || '"'`,
      );
    });
  });
}

function requireStringField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is null`,
    sql`${sql.lit(context)} || ' is required'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and json_typeof(${field}) != 'string'`,
    sql`${sql.lit(context)} || ' must be a string'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and trim(trim(both '"' from ${field}::text)) = ''`,
    sql`${sql.lit(context)} || ' must not be empty'`,
  );
}

function optionalIntegerField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
  opts: { min?: number; max?: number } = {},
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is not null and (
      json_typeof(${field}) != 'number'
      or try_cast(trim(both '"' from ${field}::text) as int) is null
    )`,
    sql`${sql.lit(context)} || ' must be an integer'`,
  );
  if (opts.min !== undefined) {
    s.throwErrorIf(
      sql`${field} is not null and try_cast(trim(both '"' from ${field}::text) as int) < ${
        sql(opts.min.toString())
      }`,
      sql`${sql.lit(context)} || ' must be >= ${opts.min}'`,
    );
  }
  if (opts.max !== undefined) {
    s.throwErrorIf(
      sql`${field} is not null and try_cast(trim(both '"' from ${field}::text) as int) > ${
        sql(opts.max.toString())
      }`,
      sql`${sql.lit(context)} || ' must be <= ${opts.max}'`,
    );
  }
}

function optionalStringRecordField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is not null and json_typeof(${field}) != 'object'`,
    sql`${sql.lit(context)} || ' must be an object of strings'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and exists(
      select 1
      from json_each(${field}) as item
      where json_typeof(item.value) != 'string'
    )`,
    sql`${sql.lit(context)} || ' must be an object of strings'`,
  );
}

function requireStringArrayField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is null or json_typeof(${field}) != 'array'`,
    sql`${sql.lit(context)} || ' must be an array of strings'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and not exists(
      select 1 from json.array_each(${field})
    )`,
    sql`${sql.lit(context)} || ' must not be empty'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and exists(
      select 1
      from json.array_each(${field}) as item
      where json_typeof(item.value) != 'string'
        or trim(both '"' from item.value::text) = ''
    )`,
    sql`${sql.lit(context)} || ' must contain only non-empty strings'`,
  );
}

function requireStringRecordField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is null or json_typeof(${field}) != 'object'`,
    sql`${sql.lit(context)} || ' must be an object of strings'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and not exists(select 1 from json_each(${field}))`,
    sql`${sql.lit(context)} || ' must not be empty'`,
  );
  s.throwErrorIf(
    sql`${field} is not null and exists(
      select 1
      from json_each(${field}) as item
      where json_typeof(item.value) != 'string'
        or trim(both '"' from item.value::text) = ''
    )`,
    sql`${sql.lit(context)} || ' must contain only non-empty strings'`,
  );
}

function optionalBooleanField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is not null and json_typeof(${field}) != 'boolean'`,
    sql`${sql.lit(context)} || ' must be a boolean'`,
  );
}

function optionalJsonObjectField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is not null and json_typeof(${field}) != 'object'`,
    sql`${sql.lit(context)} || ' must be an object'`,
  );
}

function optionalJsonArrayField(
  s: IStatementsBase,
  config: AnyExpr,
  key: string,
  context: string,
) {
  const field = jsonField(config, key);
  s.throwErrorIf(
    sql`${field} is not null and json_typeof(${field}) != 'array'`,
    sql`${sql.lit(context)} || ' must be an array'`,
  );
}

function validateFileSystemWatches(
  s: IStatementsBase,
  config: AnyExpr,
  context: string,
) {
  const watches = jsonField(config, "watches");
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      where json_typeof(watch.value) != 'object'
    )`,
    sql`${sql.lit(context)} || '.watches must contain only objects'`,
  );
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch,
           json_each(watch.value) as field
      where field.key not in (
        'name', 'root', 'path', 'recursive', 'include_existing', 'extensions',
        'settle_ms', 'poll_interval_ms', 'max_files_per_scan',
        'max_hash_bytes', 'max_hashes_per_poll', 'hash_timeout_ms'
      )
    )`,
    sql`${sql.lit(context)} || '.watches contains an unknown field'`,
  );
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      where json_typeof(watch.value->'name') != 'string'
        or trim(watch.value->>'name') = ''
        or json_typeof(watch.value->'root') != 'string'
        or trim(watch.value->>'root') = ''
    )`,
    sql`${
      sql.lit(context)
    } || '.watches requires non-empty string name and root fields'`,
  );
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      group by watch.value->>'name'
      having count(*) > 1
    )`,
    sql`${sql.lit(context)} || '.watches names must be unique'`,
  );
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      where ${config}->'roots'->(watch.value->>'root') is null
    )`,
    sql`${sql.lit(context)} || '.watches references an unknown root'`,
  );
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      where (watch.value->'path' is not null and json_typeof(watch.value->'path') != 'string')
        or (watch.value->'recursive' is not null and json_typeof(watch.value->'recursive') != 'boolean')
        or (watch.value->'include_existing' is not null and json_typeof(watch.value->'include_existing') != 'boolean')
    )`,
    sql`${sql.lit(context)} || '.watches has an invalid path or boolean field'`,
  );
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      where watch.value->'extensions' is not null
        and (
          json_typeof(watch.value->'extensions') != 'array'
          or exists(
            select 1
            from json.array_each(watch.value->'extensions') as extension
            where json_typeof(extension.value) != 'string'
              or trim(both '.' from trim(both '"' from extension.value::text)) = ''
          )
        )
    )`,
    sql`${
      sql.lit(context)
    } || '.watches.extensions must contain only non-empty extensions'`,
  );
  for (
    const field of [
      "settle_ms",
      "poll_interval_ms",
      "max_files_per_scan",
      "max_hash_bytes",
      "max_hashes_per_poll",
      "hash_timeout_ms",
    ]
  ) {
    s.throwErrorIf(
      sql`${watches} is not null and exists(
        select 1
        from json.array_each(${watches}) as watch
        where watch.value->${sql.lit(field)} is not null
          and (
            json_typeof(watch.value->${sql.lit(field)}) != 'number'
            or try_cast(watch.value->>${sql.lit(field)} as bigint) is null
            or try_cast(watch.value->>${sql.lit(field)} as bigint) <= 0
          )
      )`,
      sql`${sql.lit(context)} || ${
        sql.lit(`.watches.${field} must be a positive integer`)
      }`,
    );
  }
  s.throwErrorIf(
    sql`${watches} is not null and exists(
      select 1
      from json.array_each(${watches}) as watch
      where coalesce(try_cast(watch.value->>'max_files_per_scan' as bigint), 10000) > 100000
        or coalesce(try_cast(watch.value->>'max_hashes_per_poll' as bigint), 8) > 64
        or coalesce(try_cast(watch.value->>'max_hashes_per_poll' as bigint), 8)
          > coalesce(try_cast(watch.value->>'max_files_per_scan' as bigint), 10000)
    )`,
    sql`${sql.lit(context)} || '.watches scan and hash limits are invalid'`,
  );
}

const externalDriverDefinition: EdgeDriverDefinition = {
  guidePath: "external",
  actions: {},
  events: {},
  validateConfig(s, config, context) {
    requireJsonObject(s, config, `${context} must be an object`);
    validateAllowedKeys(s, config, [
      "driver_config",
      "hello_timeout_ms",
      "init_timeout_ms",
      "dispatch_timeout_ms",
      "shutdown_grace_timeout_ms",
    ], context);
    optionalJsonObjectField(
      s,
      config,
      "driver_config",
      `${context}.driver_config`,
    );
    for (
      const field of [
        "hello_timeout_ms",
        "init_timeout_ms",
        "dispatch_timeout_ms",
        "shutdown_grace_timeout_ms",
      ]
    ) {
      optionalIntegerField(s, config, field, `${context}.${field}`, { min: 1 });
    }
  },
};

export const edgeDriverDefinitions: {
  [K in BuiltInEdgeDriverTypeName]: BuiltInEdgeDriverDefinition<K>;
} = {
  http_client: {
    guidePath: "http-client",
    actions: {
      request: { effect: "business_effect" },
      fetch_to_file: { effect: "business_effect" },
      upload_file: { effect: "business_effect" },
    },
    events: {
      response: { durability: "durable" },
      complete: { durability: "durable" },
      error: { durability: "durable" },
    },
    validateConfig(s, config, context) {
      requireJsonObject(s, config, `${context} must be an object`);
      validateAllowedKeys(s, config, [
        "base_url",
        "allowed_methods",
        "allowed_path_prefixes",
        "headers",
        "file_roots",
        "allow_http",
        "connect_timeout_ms",
        "request_timeout_ms",
        "max_request_bytes",
        "max_response_bytes",
        "max_file_bytes",
        "queue_capacity",
      ], context);
      requireStringField(s, config, "base_url", `${context}.base_url`);
      requireStringArrayField(
        s,
        config,
        "allowed_methods",
        `${context}.allowed_methods`,
      );
      requireStringArrayField(
        s,
        config,
        "allowed_path_prefixes",
        `${context}.allowed_path_prefixes`,
      );
      optionalStringRecordField(s, config, "headers", `${context}.headers`);
      optionalStringRecordField(
        s,
        config,
        "file_roots",
        `${context}.file_roots`,
      );
      optionalBooleanField(s, config, "allow_http", `${context}.allow_http`);
      for (
        const field of [
          "connect_timeout_ms",
          "request_timeout_ms",
          "max_request_bytes",
          "max_response_bytes",
          "max_file_bytes",
          "queue_capacity",
        ]
      ) {
        optionalIntegerField(s, config, field, `${context}.${field}`, {
          min: 1,
        });
      }
    },
  },
  file_system: {
    guidePath: "file-system",
    actions: {
      write_file: { effect: "business_effect" },
      read_file: { effect: "read_only" },
      move: { effect: "business_effect" },
      copy: { effect: "business_effect" },
      delete: { effect: "business_effect" },
      stat: { effect: "read_only" },
      list: { effect: "read_only" },
      mkdir: { effect: "business_effect" },
    },
    events: {
      complete: { durability: "durable" },
      error: { durability: "durable" },
      file_settled: { durability: "durable" },
    },
    validateConfig(s, config, context) {
      requireJsonObject(s, config, `${context} must be an object`);
      validateAllowedKeys(s, config, [
        "roots",
        "allowed_operations",
        "watches",
        "max_read_bytes",
        "max_write_bytes",
        "max_list_entries",
        "queue_capacity",
      ], context);
      requireStringRecordField(s, config, "roots", `${context}.roots`);
      requireStringArrayField(
        s,
        config,
        "allowed_operations",
        `${context}.allowed_operations`,
      );
      optionalJsonArrayField(s, config, "watches", `${context}.watches`);
      s.throwErrorIf(
        sql`${config}->'watches' is not null
          and exists(select 1 from json.array_each(${config}->'watches'))
          and not exists(
            select 1
            from json.array_each(${config}->'allowed_operations') as operation
            where trim(both '"' from operation.value::text) = 'watch'
          )`,
        sql`${
          sql.lit(context)
        } || '.watches requires watch in allowed_operations'`,
      );
      s.throwErrorIf(
        sql`exists(
          select 1
          from json.array_each(${config}->'allowed_operations') as operation
          where trim(both '"' from operation.value::text) not in (
            'write_file', 'read_file', 'move', 'copy', 'delete', 'stat',
            'list', 'mkdir', 'watch'
          )
        )`,
        sql`${
          sql.lit(context)
        } || '.allowed_operations contains an unsupported operation'`,
      );
      validateFileSystemWatches(s, config, context);
      for (
        const field of [
          "max_read_bytes",
          "max_write_bytes",
          "max_list_entries",
          "queue_capacity",
        ]
      ) {
        optionalIntegerField(s, config, field, `${context}.${field}`, {
          min: 1,
        });
      }
    },
  },
  document_printer: {
    guidePath: "document-printer",
    actions: { print: { effect: "business_effect" } },
    events: {
      complete: { durability: "durable" },
      error: { durability: "durable" },
    },
    validateConfig(s, config, context) {
      requireJsonObject(s, config, `${context} must be an object`);
      validateAllowedKeys(s, config, ["printer_name", "timeout_ms"], context);
      requireStringField(s, config, "printer_name", `${context}.printer_name`);
      s.throwErrorIf(
        sql`octet_length(${config}->>'printer_name') > 512`,
        sql.lit`Printer name must be at most 512 bytes`,
      );
      optionalIntegerField(s, config, "timeout_ms", `${context}.timeout_ms`, {
        min: 1,
        max: 300000,
      });
    },
  },
  raw_printer: {
    guidePath: "raw-printer",
    actions: { print: { effect: "business_effect" } },
    events: {
      complete: { durability: "durable" },
      error: { durability: "durable" },
    },
    validateConfig(s, config, context) {
      requireJsonObject(s, config, `${context} must be an object`);
      requireStringField(s, config, "transport", `${context}.transport`);
      s.throwErrorIf(
        sql`${config}->>'transport' not in ('tcp', 'windows_queue')`,
        sql.lit`Raw printer transport must be tcp or windows_queue`,
      );
      s.if(sql`${config}->>'transport' = 'tcp'`, (s) => {
        validateAllowedKeys(s, config, [
          "transport",
          "host",
          "port",
          "timeout_ms",
        ], context);
        requireStringField(s, config, "host", `${context}.host`);
        s.throwErrorIf(
          sql`${config}->>'port' is null`,
          sql.lit`Raw printer TCP port is required`,
        );
        optionalIntegerField(s, config, "port", `${context}.port`, {
          min: 1,
          max: 65535,
        });
        s.throwErrorIf(
          sql`octet_length(${config}->>'host') > 512`,
          sql.lit`Printer host must be at most 512 bytes`,
        );
      }, (s) => {
        validateAllowedKeys(s, config, [
          "transport",
          "printer_name",
          "timeout_ms",
        ], context);
        requireStringField(
          s,
          config,
          "printer_name",
          `${context}.printer_name`,
        );
        s.throwErrorIf(
          sql`octet_length(${config}->>'printer_name') > 512`,
          sql.lit`Printer name must be at most 512 bytes`,
        );
      });
      optionalIntegerField(s, config, "timeout_ms", `${context}.timeout_ms`, {
        min: 1,
        max: 300000,
      });
    },
  },
};

export function getEdgeDriverDefinition(type: string) {
  if (type.startsWith("external:") && type.length > "external:".length) {
    return externalDriverDefinition;
  }
  switch (type) {
    case "http_client":
      return edgeDriverDefinitions.http_client;
    case "file_system":
      return edgeDriverDefinitions.file_system;
    case "document_printer":
      return edgeDriverDefinitions.document_printer;
    case "raw_printer":
      return edgeDriverDefinitions.raw_printer;
    default:
      throw new Error(`Unknown edge driver type "${type}"`);
  }
}

export function getEdgeDriverSetupManifest(type: string) {
  const definition = getEdgeDriverDefinition(type);
  return {
    type,
    guideUrl: `https://yolm.ai/edge-drivers/v1/${definition.guidePath}.md`,
    actions: definition.actions,
    events: definition.events,
  };
}
