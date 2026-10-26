import type { SparkCapability } from "blocks/spark";
import {
  blockToolset,
  toolBoolean,
  toolId,
  toolInteger,
  toolObject,
  toolPage,
  toolString,
  toolValue,
} from "blocks/spark/tool_contract";
import { sql } from "std/sql_utils";
import type { LocationsBlock } from "./index";
import { locationPaths } from "./queries";

/** Optional management tools for the shared physical hierarchy. No new schema. */
export function locationsSparkCapability(
  block: LocationsBlock,
  opts: { permission: string },
): SparkCapability {
  const tools = blockToolset("locations", opts.permission);
  return {
    name: "locations",
    label: "Locations",
    permission: opts.permission,
    description: "Find and manage shared locations and their hierarchy.",
    functions: [
      tools.read(
        "list",
        "List location paths, including inactive locations.",
        "{offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["offset", "limit"]);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('items', coalesce((select json_agg(json_build_object('id', id, 'path', path, 'name', name, 'parent_location_id', parent_location_id, 'active', active)) from (select paths.*, location.active from (${locationPaths()}) paths join db.locations location on location.id = paths.id order by paths.id limit tool_limit offset tool_offset)), '[]'::json))`,
          );
        },
      ),
    ],
    actions: [
      tools.action(
        "save",
        "Create, rename, move or deactivate a location. Omitted fields retain their values.",
        `{id?:number;name?:string;parent_location_id?:number|null;active?:boolean${
          block.hasCodes ? ";code?:string|null" : ""
        }${block.hasDescription ? ";description?:string|null" : ""}}`,
        (s) => {
          const strings = [
            { key: "name", max: 200 },
            ...(block.hasCodes ? [{ key: "code", max: 80 }] : []),
            ...(block.hasDescription
              ? [{ key: "description", max: 1000 }]
              : []),
          ];
          toolObject(s, [
            "id",
            "parent_location_id",
            "active",
            ...strings.map((f) => f.key),
          ]);
          toolInteger(s, "id");
          toolInteger(s, "parent_location_id");
          toolBoolean(s, "active");
          for (const f of strings) toolString(s, f.key, f.max);
          s.throwErrorIf(
            sql`(p_input ? 'name' or ${toolId("id")} is null) and nullif(trim(${
              toolValue("name")
            }), '') is null`,
            sql.lit`A location needs a name.`,
          );
          s.defScalar("saved_id", toolId("id"));
          s.if(sql`saved_id is null`, (s) => {
            s.modify(
              sql`insert into db.locations (name, parent_location_id, active${
                strings.length > 1
                  ? sql`, ${
                    strings.filter((f) => f.key !== "name").map((f) =>
                      sql.ref(f.key)
                    )
                  }`
                  : sql``
              }) values (trim(${toolValue("name")}), ${
                toolId("parent_location_id")
              }, coalesce(try_cast(${toolValue("active")} as boolean), true)${
                strings.length > 1
                  ? sql`, ${
                    strings.filter((f) => f.key !== "name").map((f) =>
                      toolValue(f.key)
                    )
                  }`
                  : sql``
              }) returning id into saved_id`,
            );
            block.opts.afterCreate?.(s, sql`saved_id`);
          }).else((s) => {
            s.throwErrorIf(
              sql`not exists(select 1 from db.locations where id = saved_id)`,
              sql.lit`Location not found.`,
            );
            s.modify(
              sql`update db.locations set ${
                strings.map((f) =>
                  sql`${sql.ref(f.key)} = case when p_input ? ${
                    sql.lit(f.key)
                  } then ${toolValue(f.key)} else ${sql.ref(f.key)} end`
                )
              }, parent_location_id = case when p_input ? 'parent_location_id' then ${
                toolId("parent_location_id")
              } else parent_location_id end, active = coalesce(try_cast(${
                toolValue("active")
              } as boolean), active) where id = saved_id`,
            );
          });
          s.callStoredProcedure("validate_location_structure");
          s.setScalar("tool_output", sql`json_build_object('id', saved_id)`);
        },
        false,
        (s) => {
          s.callStoredProcedure("validate_location_structure");
        },
      ),
    ],
    doc:
      "Use full paths to disambiguate names. Reparent by ID. Deactivate instead of deleting historical locations. Creation runs the configured afterCreate hook. Custom required fields need defaults or that hook.",
  };
}
