import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { BooleanExpr } from "std/sql_utils";
import { Show } from "std/ui";
import type { Node } from "std/ui";

/** Evaluate policy on the server; UI visibility never replaces mutation checks. */
export function AccessCheck(
  props: { when: BooleanExpr; children: Node; fallback?: Node },
) {
  return (
    <Data procedure={(s) => s.defScalar("access_policy_allowed", props.when)}>
      <Show when={sql`access_policy_allowed`} fallback={props.fallback}>
        {props.children}
      </Show>
    </Data>
  );
}
