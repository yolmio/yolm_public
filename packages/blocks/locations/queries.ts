import { system } from "std/system";
import { sql } from "std/sql_utils";

/** Location paths and stable-ID ancestry; display names and codes may repeat. */
export function locationPaths() {
  const fields = system.db.tables.locations.fields;
  const code = fields.code ? sql`code` : sql`cast(null as string)`;
  const kind = fields.kind
    ? sql`cast(kind as string)`
    : sql`cast(null as string)`;
  const description = fields.description
    ? sql`description`
    : sql`cast(null as string)`;
  return sql`with recursive source as (
    select id, parent_location_id, name, ${code} as code, ${kind} as kind,
      ${description} as description from db.locations
  ), tree as (  select id, parent_location_id, name, code, kind, description, 0 as depth,
    coalesce(code || ' · ', '') || name as path, '|' as ancestor_ids
  from source where parent_location_id is null
  union all
  select child.id, child.parent_location_id, child.name, child.code, child.kind,
    child.description, parent.depth + 1,
    parent.path || ' / ' || coalesce(child.code || ' · ', '') || child.name,
    parent.ancestor_ids || parent.id || '|'
  from source child join tree parent on parent.id = child.parent_location_id
) select * from tree`;
}
