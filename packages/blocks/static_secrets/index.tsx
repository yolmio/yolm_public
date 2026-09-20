import { system } from "std/system";
import type { Block } from "std/system";

const sysStaticSecretTable = "sys_static_secrets";

/**
 * Solution block that adds the `sys_static_secrets` table for storing
 * named secret byte values (API keys, signing keys) used by the system.
 * Sample data is intentionally skipped so secrets are never seeded.
 *
 * Add to `core.tsx`:
 *
 * ```ts
 * system.addBlock(new StaticSecretsBlock());
 * ```
 *
 * @category Block
 */
export class StaticSecretsBlock implements Block {
  blockName = "StaticSecretsBlock";
  definedByBlock?: string;
  componentDependencies: string[] = [];
  description: string | undefined;
  initialize() {
    system.db.table(sysStaticSecretTable, (t) => {
      t.sampleData({
        skipSampleData: true,
      });
      t.renameFrom("sys_static_secret");
      t.string("name", 256).notNull();
      t.bytes("value", 131_072).notNull();
    });
    this.description =
      "Provides a way to store static secrets that are used by the system.";
  }
}

/**
 * Returns `true` if the `sys_static_secrets` table exists, i.e. a
 * {@link StaticSecretsBlock} has been registered. Use to guard code that
 * reads static secrets so it degrades gracefully when the block is absent.
 *
 * @category Helper
 */
export function hasStaticSecretTable() {
  return system.db.hasTable(sysStaticSecretTable);
}
