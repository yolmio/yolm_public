import { type Sql, sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { type StoredProcedureFieldSetOpts, system } from "std/system";

const FANOUT = 16;

/** Preserve SQL collation and null semantics without a generated OR per name. */
export function sparkActionNameCondition(
  names: readonly string[],
  name: Sql,
): Sql {
  return names.length === 0 ? sql`false` : sql`${name} in (
    select value #>> '{}' from json.array_each(${
    sql.lit(JSON.stringify(names))
  }::json)
  )`;
}

interface ActionEntry {
  readonly actionName: string;
  readonly procedure: (s: GeneralServerStatements) => void;
}

interface DispatchBranch {
  readonly name: string;
  readonly first: number;
  readonly end: number;
}

/**
 * Owns the complete static call tree: every leaf has the same record contract,
 * every router has at most 16 calls, and no edge speculatively compiles a child.
 * The returned emitter binds that record; callers cannot invent a target name.
 */
export function registerSparkActionDispatch(opts: {
  readonly name: string;
  readonly record: StoredProcedureFieldSetOpts;
  readonly actions: readonly ActionEntry[];
}): (s: GeneralServerStatements) => void {
  if (opts.actions.length === 0) {
    throw new Error("Spark action dispatch requires at least one action.");
  }
  const actionNames = new Set<string>();
  for (const action of opts.actions) {
    const identity = system.collation === "NoCase"
      ? action.actionName.toLowerCase()
      : action.actionName;
    if (actionNames.has(identity)) {
      throw new Error(`Duplicate Spark action name: ${action.actionName}`);
    }
    actionNames.add(identity);
  }
  const ordinalJson = JSON.stringify(Object.fromEntries(
    opts.actions.map((action, index) => [action.actionName, index]),
  ));
  const recordName = opts.record.name;
  const ordinalName = "spark_action_dispatch_ordinal";
  const ordinal = sql.ref(ordinalName);
  const inputRecords = { [recordName]: recordName };
  let branches: DispatchBranch[] = opts.actions.map((action, index) => {
    const name = `${opts.name}_leaf_${index}`;
    system.storedProcedure({
      name,
      transaction: "standalone",
      inputRecords: [opts.record],
      procedure: action.procedure,
    });
    return { name, first: index, end: index + 1 };
  });
  let layer = 0;
  let childIsLeaf = true;
  do {
    const next: DispatchBranch[] = [];
    for (let start = 0; start < branches.length; start += FANOUT) {
      const children = branches.slice(start, start + FANOUT);
      const name = `${opts.name}_route_${layer}_${start / FANOUT}`;
      const passOrdinal = !childIsLeaf;
      system.storedProcedure({
        name,
        transaction: "standalone",
        // NULL means an unknown action and cannot select a branch.
        inputScalars: [{ name: ordinalName, type: "Int" }],
        inputRecords: [opts.record],
        procedure: (s) => {
          for (const child of children) {
            s.if(
              sql`${ordinal} >= ${child.first} and ${ordinal} < ${child.end}`,
              (s) =>
                s.callStoredProcedure(child.name, {
                  prewarm: "never",
                  inputRecords,
                  ...(passOrdinal
                    ? { inputScalars: { [ordinalName]: ordinal } }
                    : {}),
                }),
            );
          }
        },
      });
      next.push({
        name,
        first: children[0].first,
        end: children[children.length - 1].end,
      });
    }
    branches = next;
    layer++;
    childIsLeaf = false;
  } while (branches.length > 1);
  const root = branches[0].name;
  system.storedProcedure({
    name: opts.name,
    transaction: "standalone",
    inputRecords: [opts.record],
    procedure: (s) => {
      // Metadata grows with registrations, native control flow does not.
      // An unknown name has no ordinal and matches no routing branch.
      s.callStoredProcedure(root, {
        prewarm: "never",
        inputRecords,
        inputScalars: {
          [ordinalName]: sql`(select try_cast(value as int)
            from json.object_each(${sql.lit(ordinalJson)}::json)
            where key = ${sql.ref(recordName, "action_name")})`,
        },
      });
    },
  });
  return (s) =>
    s.callStoredProcedure(opts.name, { prewarm: "never", inputRecords });
}
