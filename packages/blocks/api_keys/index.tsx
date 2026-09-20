import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import { ApiKeyManager } from "./pages/manager";
import type { EndpointStatements } from "std/statements";

export class ApiKeyBlock implements Block {
  blockName = "ApiKeyBlock";
  componentDependencies: string[] = [];
  description: string | undefined;

  encryptionKey = "api_key_encryption";

  initialize() {
    const db = system.db;
    // Main API keys table
    db.table("api_keys", (table) => {
      table.string("name", 100).notNull();
      table.secret("key_value", 1000, this.encryptionKey).notNull().default(
        sql`crypto.encrypt(bytes.to_hex(crypto.random_bytes(32)), ${
          sql.lit(this.encryptionKey)
        })`,
      );
      table.bool("active").notNull().default(sql`true`);
      table.timestamp("created_at").notNull().default(sql`now()`);
      table.recordDisplayName(["name"]);
    });
    this.componentDependencies = ["ApiKeyManager"];
    this.description =
      "API key management with UI and header-based authentication for external APIs";
  }

  validateApiKey<T extends EndpointStatements>(
    s: T,
  ) {
    // Get Authorization header
    s.getHeader(sql.lit`yolm-api-key`, "auth_header");
    // Check if header exists
    s.if(sql`auth_header is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object(
        'error', 'Missing API key',
        'message', 'Please provide an API key in the Authorization header'
      )`);
    });

    // // Get all active API keys and decrypt them for comparison
    s.defRecord(
      "key_info",
      sql`
      select id from api_keys where crypto.decrypt(key_value, ${
        sql.lit(this.encryptionKey)
      }) = auth_header and active = true`,
    );
    // // Check if key exists and is active
    s.if(sql`key_info.id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql`json_build_object(
        'error', 'Invalid API key',
        'message', 'The provided API key is invalid or has been revoked'
      )`);
    });
  }

  /**
   * Helper to generate a new API key programmatically
   */
  // generateApiKey<T extends IServerBaseStatements>(
  //   s: T,
  //   config: {
  //     name: string;
  //     resultKey: string;
  //     prefix?: string;
  //   }
  // ) {
  //   s.defScalar(config.resultKey, { type: "String" });
  //   const prefix = config.prefix || "yk_live";
  //   // Generate secure random key
  //   s.defScalar("key_bytes", sql`crypto.random_bytes(32)`);
  //   s.defScalar("key_string", sql`'${prefix}_' || bytes.to_hex(key_bytes)`);
  //   s.defScalar("key_hash", sql`crypto.sha256(key_string)`);

  //   // Insert the key (store only hash)
  //   s.modify(sql`
  //     insert into api_keys (name, key_prefix, key_hash)
  //     values (
  //       ${sql.lit(config.name)},
  //       ${sql.lit(prefix)},
  //       key_hash
  //     )
  //   `);
  //   // Return the full key (to be shown once to user)
  //   s.setScalar(config.resultKey, sql`key_string`);
  // }

  // Export UI components
  static ApiKeyManager = ApiKeyManager;
}

export function useApiKeyBlock() {
  return system.block(ApiKeyBlock);
}
