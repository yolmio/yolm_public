import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";

/**
 * Returns an item's complete subtree, including the item itself.
 *
 * Drive keeps only the canonical parent pointer. Recursive traversal stays
 * local to the operations that need it until observed scale justifies a
 * materialized hierarchy index.
 */
export function fileItemSubtreeIds(rootItemId: Sql) {
  return sql`
    with recursive file_item_subtree as (
      select root.id
      from db.file_items root
      where root.id = ${rootItemId}

      union all

      select child.id
      from file_item_subtree parent
      join db.file_items child
        on child.parent_file_item_id = parent.id
    )
    select id
    from file_item_subtree
  `;
}
