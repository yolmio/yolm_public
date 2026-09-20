import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import { Each, Match, Show, Switch } from "std/ui";
import type { Node } from "std/ui";

export interface SparkActionResultRenderer {
  name: string;
  render: (props: { result: Sql; status: Sql }) => Node;
}

/** One recorded result presentation shared by native chat, MCP and the drawer. */
export function SparkActionResult(props: {
  renderers: SparkActionResultRenderer[];
  actionName: Sql;
  result: Sql;
  status: Sql;
}) {
  return (
    <Show
      when={sql`${props.result} is not null`}
      fallback={
        <p className="my-2 text-sm text-secondary">
          No execution result recorded.
        </p>
      }
    >
      <Switch>
        {props.renderers.map((entry) => (
          <Match when={sql`${props.actionName} = ${sql.lit(entry.name)}`}>
            {entry.render({ result: props.result, status: props.status })}
          </Match>
        ))}
        <Match when={sql`true`}>
          <Data
            procedure={(s) =>
              s.defTable(
                "result_values",
                sql`select key, value #>> '{}' as text_value
            from json.object_each(case when json_typeof(${props.result}) = 'object' then ${props.result} else '{}'::json end)
            where json_typeof(value) in ('string', 'number', 'boolean') and key not in ('title', 'name') order by key`,
              )}
          >
            <dl className="my-3 space-y-2 text-sm">
              <Each table="result_values" recordName="result_value">
                <div className="grid grid-cols-2 gap-3">
                  <dt className="text-secondary">
                    {sql`initcap(replace(result_value.key, '_', ' '))`}
                  </dt>
                  <dd className="break-words">
                    {sql`result_value.text_value`}
                  </dd>
                </div>
              </Each>
            </dl>
          </Data>
        </Match>
      </Switch>
    </Show>
  );
}
