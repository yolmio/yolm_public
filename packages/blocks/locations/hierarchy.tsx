import { Hierarchy } from "components/hierarchy";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import type { Node } from "std/ui";
import { locationPaths } from "./queries";
import { locationText } from "./i18n";

export interface LocationHierarchyProps {
  mobile?: boolean;
  rootLocationId?: Sql;
  locationHref: (id: Sql) => Sql;
  equipmentHref?: (id: Sql) => Sql;
  headerActions?: Node;
  rowActions?: (id: Sql, name: Sql) => Node;
  footer?: Node;
}

/** Location links and branch equipment counts on the shared hierarchy UI. */
export function LocationHierarchy(props: LocationHierarchyProps) {
  return (
    <Data
      procedure={(s) => {
        s.defTable("location_nodes", locationPaths());
        if (props.equipmentHref) {
          s.defTable(
            "equipment_counts",
            sql`select location_id, count(*) as total from db.equipment group by location_id`,
          );
        }
      }}
    >
      <Hierarchy
        label={locationText("hierarchy")}
        expansionParam="expanded_locations"
        rootId={props.rootLocationId}
        mobile={props.mobile}
        rowAttributes={(id) => ({
          "data-testid": "location-card",
          "data-location-id": id,
        })}
        query={sql`select n.id, n.parent_location_id as parent_id, n.name,
          coalesce(n.code || ' · ', '') || n.name as path_label, n.code as subtitle, location.active
          from location_nodes n join db.locations location on location.id = n.id`}
        searchLabel={props.rootLocationId
          ? locationText("searchWithin")
          : locationText("searchAll")}
        searchPlaceholder={locationText("search")}
        expandPrefix={locationText("expandPrefix")}
        collapsePrefix={locationText("collapsePrefix")}
        emptyMessage={props.rootLocationId
          ? locationText("noSublocations")
          : locationText("noLocations")}
        noMatchesMessage={locationText("noMatches")}
        header={!props.rootLocationId && (
          <header className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">
              {locationText("locations")}
            </h1>
            {props.headerActions}
          </header>
        )}
        beforeRows={(search) => (
          <div className="flex flex-col gap-1 text-sm text-secondary sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-medium">
              {sql`case when trim(${search}) != '' then ${
                locationText("searchResults")
              } else ${
                props.rootLocationId
                  ? locationText("sublocations")
                  : locationText("topLevel")
              } end`}
            </h2>
            {props.equipmentHref && (
              <span className="text-xs">{locationText("countsHelp")}</span>
            )}
          </div>
        )}
        renderName={(id, name) => (
          <a
            href={props.locationHref(id)}
            className="block break-words py-1 font-medium hover:underline"
          >
            {name}
          </a>
        )}
        rowActions={(id, name) => (
          <>
            {props.equipmentHref && (
              <a
                className="flex h-10 shrink-0 items-center text-xs text-secondary hover:underline"
                href={props.equipmentHref(id)}
              >
                {sql`coalesce((select sum(e.total) from equipment_counts e join location_nodes c on c.id = e.location_id
                  where c.id = ${id} or strpos(c.ancestor_ids, '|' || ${id} || '|') > 0), 0) || ' ' || ${
                  locationText("equipment")
                }`}
              </a>
            )}
            {props.rowActions?.(id, name)}
          </>
        )}
        footer={props.footer}
      />
    </Data>
  );
}
