import { sql } from "../std/sql_utils";
import { system } from "std/system";
import { EventHandlers } from "std/ui";
import { Data } from "std/data";

export function TimeGreeting() {
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("time", sql`now()`);
      }}
    >
      {sql`case
   when date.part(hour, time) between 5 and 11 then 'Good morning'
   when date.part(hour, time) between 12 and 16 then 'Good afternoon'
   when date.part(hour, time) between 17 and 21 then 'Good evening'
   else 'Good night'
  end`}
      <EventHandlers
        mount={(s) => {
          s.loop((s) => {
            s.sleep(60_000);
            s.setScalar("time", sql`now()`);
          });
        }}
      />
    </Data>
  );
}

export function CurrentUserName() {
  const userTable = system.db.tables.sys_users;
  const expr = userTable.recordDisplayName!.expr(
    ...userTable.recordDisplayName!.fields.map((f) => sql`${sql.ref(f)}`),
  );
  return (
    <Data
      noRefetch
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar(
          "user_name",
          sql`(select ${expr} from sys_users where id = current_user)`,
        );
      }}
    >
      {sql`coalesce(user_name, '')`}
    </Data>
  );
}

export function CurrentUserFirstName() {
  const userTable = system.db.tables.sys_users;
  const expr = userTable.recordDisplayName!.expr(
    ...userTable.recordDisplayName!.fields.map((f) => sql`${sql.ref(f)}`),
  );
  return (
    <Data
      noRefetch
      pendingFallback={null}
      errorFallback={null}
      procedure={(s) => {
        s.defScalar(
          "user_name",
          sql`(select ${expr} from sys_users where id = current_user)`,
        );
        s.defScalar("space_pos", sql`position(' ' in user_name)`);
        s.defScalar(
          "first_name",
          sql`case when space_pos > 0 then substring(user_name, 1, space_pos - 1) else user_name end`,
        );
      }}
    >
      {sql`coalesce(first_name, '')`}
    </Data>
  );
}
