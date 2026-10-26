import { sql } from "std/sql_utils";
import { system } from "std/system";

// Called inside the writer's transaction, so an invalid change rolls back.
/** Register the transaction-local location hierarchy validator for location writers. */
export function registerLocationStructureValidation() {
  if (
    system.storedProcedures.some((procedure) =>
      procedure.name === "validate_location_structure"
    )
  ) return;
  system.storedProcedure({
    name: "validate_location_structure",
    transaction: "caller",
    procedure: (s) => {
      s.throwErrorIf(
        sql`exists(select 1 from db.locations where trim(name) = '')`,
        sql.lit`Every location needs a name.`,
      );
      if (system.db.tables.locations.fields.code) {
        s.throwErrorIf(
          sql`exists(select 1 from db.locations where nullif(trim(code), '') is not null group by parent_location_id, lower(trim(code)) having count(*) > 1)`,
          sql
            .lit`Location codes must be unique within their parent. Review duplicate codes before saving.`,
        );
      }
      s.throwErrorIf(
        sql`(with recursive connected as (
      select id from db.locations where parent_location_id is null
      union all
      select child.id from db.locations child join connected parent on child.parent_location_id = parent.id
    ) select count(*) from connected) <> (select count(*) from db.locations)`,
        sql.lit`A location cannot be placed inside itself or its descendants.`,
      );
    },
  });
}
