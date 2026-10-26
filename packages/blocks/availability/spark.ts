import type { SparkCapability } from "blocks/spark";
import {
  blockToolset,
  toolId,
  toolInteger,
  toolObject,
  toolPage,
  toolString,
  toolValue,
} from "blocks/spark/tool_contract";
import { sql } from "std/sql_utils";

/** Organization-wide time-off management; use a calendar administrator permission. */
export function availabilitySparkCapability(
  opts: { permission: string },
): SparkCapability {
  const tools = blockToolset("availability", opts.permission);
  return {
    name: "availability",
    label: "Availability",
    permission: opts.permission,
    description: "Inspect and manage host time off.",
    functions: [
      tools.read(
        "time_off",
        "List time-off periods for a host.",
        "{user_id:number;offset?:number;limit?:number}",
        (s) => {
          toolObject(s, ["user_id", "offset", "limit"]);
          toolInteger(s, "user_id", true);
          toolPage(s);
          s.setScalar(
            "tool_output",
            sql`json_build_object('items',coalesce((select json_agg(json_build_object('id',id,'title',title,'start_date',start_date,'end_date',end_date,'notes',notes)) from (select * from db.availability_time_off_periods where sys_user_id=${
              toolId("user_id")
            } order by id limit tool_limit offset tool_offset)),'[]'::json))`,
          );
        },
      ),
    ],
    actions: [
      tools.action(
        "save_time_off",
        "Create or replace time off. Existing appointments are not cancelled or reassigned.",
        "{id?:number;user_id:number;title:string;start_date:string;end_date:string;notes?:string}",
        (s) => {
          toolObject(s, [
            "id",
            "user_id",
            "title",
            "start_date",
            "end_date",
            "notes",
          ]);
          toolInteger(s, "id");
          toolInteger(s, "user_id", true);
          toolString(s, "title", 100, true);
          toolString(s, "start_date", 10, true);
          toolString(s, "end_date", 10, true);
          toolString(s, "notes", 255);
          s.throwErrorIf(
            sql`not exists(select 1 from sys_users where id=${
              toolId("user_id")
            } and not disabled)`,
            sql.lit`Host unavailable.`,
          );
          s.defScalar(
            "range_start",
            sql`try_cast(${toolValue("start_date")} as date)`,
          );
          s.defScalar(
            "range_end",
            sql`try_cast(${toolValue("end_date")} as date)`,
          );
          s.throwErrorIf(
            sql`range_start is null or range_end is null or range_start < current_date() or range_end < range_start`,
            sql.lit`Supply a valid future date range.`,
          );
          s.defScalar("saved_id", toolId("id"));
          s.if(sql`saved_id is null`, (s) =>
            s.modify(
              sql`insert into db.availability_time_off_periods(sys_user_id,title,start_date,end_date,notes) values(${
                toolId("user_id")
              },${toolValue("title")},range_start,range_end,${
                toolValue("notes")
              }) returning id into saved_id`,
            )).else((s) => {
              s.throwErrorIf(
                sql`not exists(select 1 from db.availability_time_off_periods where id=saved_id and sys_user_id=${
                  toolId("user_id")
                })`,
                sql.lit`Time off not found for that host.`,
              );
              s.modify(
                sql`update db.availability_time_off_periods set title=${
                  toolValue("title")
                },start_date=range_start,end_date=range_end,notes=${
                  toolValue("notes")
                } where id=saved_id`,
              );
            });
          s.setScalar("tool_output", sql`json_build_object('id',saved_id)`);
        },
      ),
      tools.action(
        "remove_time_off",
        "Remove a specific host's time-off period.",
        "{id:number;user_id:number}",
        (s) => {
          toolObject(s, ["id", "user_id"]);
          toolInteger(s, "id", true);
          toolInteger(s, "user_id", true);
          s.throwErrorIf(
            sql`not exists(select 1 from db.availability_time_off_periods where id=${
              toolId("id")
            } and sys_user_id=${toolId("user_id")})`,
            sql.lit`Time off not found for that host.`,
          );
          s.modify(
            sql`delete from db.availability_time_off_periods where id=${
              toolId("id")
            } and sys_user_id=${toolId("user_id")}`,
          );
          s.setScalar(
            "tool_output",
            sql`json_build_object('id',${toolId("id")},'removed',true)`,
          );
        },
      ),
    ],
    doc:
      "Requires organization-wide calendar administration. Dates follow the system's date semantics. Time off changes future availability, not existing bookings. Use scheduling tools to check actual bookability including conflicts and notice periods.",
  };
}
