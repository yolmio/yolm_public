import { locationPaths } from "./queries";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type {
  GeneralServerStatements,
  UiServerStatements,
} from "std/statements";
import { system } from "std/system";
import type { Block, TableBuilder } from "std/system";
import type { EventStore } from "blocks/events";
import { LocationHierarchy } from "./hierarchy";
import { LocationManagement } from "./management";
import { registerLocationStructureValidation } from "./procedures";

export interface LocationsBlockOptions {
  /** Register location events only when the consumer uses an event store. */
  events?: EventStore;
  /** Existing equipment/maintenance metadata; omitted for a name-and-hierarchy directory. */
  operationalMetadata?: boolean;
  codes?: boolean;
  description?: boolean;
  kinds?: { name: string; displayName: string }[];
  additionalKinds?: { name: string; displayName: string }[];
  defineLocations?: (table: TableBuilder) => void;
  /** Extra writes made by shared create forms and tools, inside the location transaction. */
  afterCreate?: (
    s: UiServerStatements | GeneralServerStatements,
    locationId: Sql,
  ) => void;
  /** Keep the imported production hierarchy without CMMS location metadata. */
  shopFloor?: boolean;
}

/** Stable physical places and optional functional equipment positions. */
export class LocationsBlock implements Block {
  blockName = "LocationsBlock";
  blockDisplayName = "Locations";
  componentDependencies = ["LocationsPage"];
  description =
    "Stable hierarchical places, storage areas, and functional equipment positions.";

  readonly locationsTable = "locations";
  static Hierarchy = LocationHierarchy;
  static Management = LocationManagement;

  constructor(readonly opts: LocationsBlockOptions = {}) {
    if (opts.kinds?.length === 0) {
      throw new Error("LocationsBlock kinds must contain at least one kind.");
    }
  }

  get hasCodes() {
    return this.opts.codes ?? this.opts.operationalMetadata ?? false;
  }
  get hasDescription() {
    return this.opts.description ?? this.opts.operationalMetadata ?? false;
  }
  get hasKinds() {
    return this.opts.kinds !== undefined ||
      Boolean(
        this.opts.operationalMetadata || this.opts.additionalKinds?.length,
      );
  }

  populate() {
    registerLocationStructureValidation();
  }

  initialize() {
    this.opts.events?.registerAggregateType({
      name: "location",
      displayName: "Location",
    });
    this.opts.events?.registerEventType({
      name: "location.created",
      displayName: "Location Created",
    });

    if (this.hasKinds) {
      system.enum_({
        name: "location_kind",
        values: [
          ...(this.opts.kinds ?? [
            { name: "site", displayName: "Site" },
            { name: "area", displayName: "Area" },
            { name: "position", displayName: "Equipment Position" },
            { name: "storage", displayName: "Storage" },
            { name: "service", displayName: "Service / Repair" },
            { name: "other", displayName: "Other" },
          ]),
          ...(this.opts.additionalKinds ?? []),
        ],
      });
    }

    system.db.table("locations", (table) => {
      table.fk("parent_location_id", "locations").onDelete("Restrict");
      table.string("name", 200).notNull();
      if (this.hasCodes) table.string("code", 80);
      if (this.hasKinds) {
        table.enum("kind", "location_kind").notNull().default(
          sql.lit(this.opts.kinds?.[0]?.name ?? "area"),
        );
      }
      if (this.hasDescription) table.string("description", 1000).multiline();
      if (this.opts.operationalMetadata && !this.opts.shopFloor) {
        table.string("role_description", 500).multiline();
        table.tinyUint("criticality").notNull().default(sql`0`);
      }
      table.bool("active").notNull().default(sql`true`);
      if (this.opts.operationalMetadata) {
        table.timestampUtc("created_at").notNull().default(sql`now()`);
      }
      if (this.opts.operationalMetadata && !this.opts.shopFloor) {
        table.string("external_system", 80);
        table.string("external_ref", 160);
      }
      if (this.hasCodes) table.unique(["parent_location_id", "code"]);
      if (this.opts.operationalMetadata && !this.opts.shopFloor) {
        table.check({
          fields: ["criticality"],
          check: ([criticality]) => sql`${criticality} <= 100`,
          errorMessage: () => sql.lit`Criticality must be between 0 and 100.`,
        });
      }
      table.recordDisplayName([
        "name",
        "parent_location_id",
        ...(this.hasCodes ? ["code"] : []),
      ], (name, parent, code) => {
        const label = this.hasCodes
          ? sql`coalesce(${code} || ' · ', '') || ${name}`
          : name;
        return sql`coalesce((select path from (${locationPaths()}) parents where parents.id = ${parent}) || ' / ', '') || ${label}`;
      });
      this.opts.defineLocations?.(table);
      table.searchConfig({
        fieldGroups: [
          ...(this.hasCodes ? [{ fields: ["code"], priority: 1 }] : []),
          {
            fields: this.hasDescription && !this.opts.shopFloor
              ? ["name", "description"]
              : ["name"],
            priority: 2,
          },
        ],
      });
    });
  }
}

/** Compact hierarchy overview suitable for an office application route. */
export function LocationsPage() {
  return (
    <LocationHierarchy locationHref={(id) => sql`'/locations/' || ${id}`} />
  );
}
