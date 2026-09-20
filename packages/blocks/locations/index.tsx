import { Card } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { system } from "std/system";
import type { Block } from "std/system";
import { Each } from "std/ui";
import type { EventsBlock } from "blocks/events";

export interface LocationsBlockOptions {
  events: EventsBlock;
}

/** Stable physical places and optional functional equipment positions. */
export class LocationsBlock implements Block {
  blockName = "LocationsBlock";
  blockDisplayName = "Locations";
  componentDependencies = ["LocationsPage"];
  description =
    "Stable hierarchical places, storage areas, and functional equipment positions.";

  constructor(readonly opts: LocationsBlockOptions) {}

  initialize() {
    this.opts.events.registerAggregateType({
      name: "location",
      displayName: "Location",
    });
    this.opts.events.registerEventType({
      name: "location.created",
      displayName: "Location Created",
    });

    system.enum_({
      name: "location_kind",
      values: [
        { name: "site", displayName: "Site" },
        { name: "area", displayName: "Area" },
        { name: "position", displayName: "Equipment Position" },
        { name: "storage", displayName: "Storage" },
        { name: "service", displayName: "Service / Repair" },
        { name: "other", displayName: "Other" },
      ],
    });

    system.db.table("locations", (table) => {
      table.fk("parent_location_id", "locations").onDelete("Restrict");
      table.string("name", 200).notNull();
      table.string("code", 80);
      table.enum("kind", "location_kind").notNull().default(sql.lit`area`);
      table.string("description", 1000).multiline();
      table.string("role_description", 500).multiline();
      table.tinyUint("criticality").notNull().default(sql`0`);
      table.bool("active").notNull().default(sql`true`);
      table.string("external_system", 80);
      table.string("external_ref", 160);
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.unique(["parent_location_id", "code"]);
      table.check({
        fields: ["criticality"],
        check: ([criticality]) => sql`${criticality} <= 100`,
        errorMessage: () => sql.lit`Criticality must be between 0 and 100.`,
      });
      table.recordDisplayName(
        ["code", "name"],
        (code, name) => sql`coalesce(${code} || ' · ', '') || ${name}`,
      );
      table.searchConfig({
        fieldGroups: [
          { fields: ["code"], priority: 1 },
          { fields: ["name", "description"], priority: 2 },
        ],
      });
    });
  }
}

/** Compact hierarchy overview suitable for an office application route. */
export function LocationsPage() {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "location_rows",
          sql`
            with recursive tree as (
              select
                l.id,
                l.parent_location_id,
                l.name,
                l.code,
                cast(l.kind as string) as kind,
                l.criticality,
                l.active,
                0 as depth,
                coalesce(l.code || ' · ', '') || l.name as path
              from db.locations l
              where l.parent_location_id is null

              union all

              select
                child.id,
                child.parent_location_id,
                child.name,
                child.code,
                cast(child.kind as string),
                child.criticality,
                child.active,
                parent.depth + 1,
                parent.path || ' / ' || coalesce(child.code || ' · ', '') || child.name
              from db.locations child
              join tree parent on parent.id = child.parent_location_id
            )
            select tree.* from tree
            order by path
          `,
        );
      }}
    >
      <div className="flex flex-col gap-3">
        <Each table="location_rows" recordName="location">
          <Card variant="outlined" className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <MaterialIcon icon="LocationOn" className="text-primary-600" />
                <div className="min-w-0">
                  <Typography level="title-sm">{sql`location.path`}</Typography>
                  <Typography level="body-xs" color="neutral">
                    {sql`initcap(replace(location.kind, '_', ' ')) || ' · criticality ' || location.criticality`}
                  </Typography>
                </div>
              </div>
              <Chip size="sm" variant="soft" color="neutral">
                {sql`initcap(replace(location.kind, '_', ' '))`}
              </Chip>
            </div>
          </Card>
        </Each>
      </div>
    </Data>
  );
}
