import { currentUserHasPermission } from "blocks/auth";
import type { SparkAction, SparkFunction } from "blocks/spark";
import { rethrowSparkActionError } from "blocks/spark/action_errors";
import { sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";

/** JSON input helpers shared by block-owned tools; never accept SQL from agents. */
export const toolValue = (key: string) => sql`p_input->>${sql.lit(key)}`;
export const toolId = (key: string) =>
  sql`try_cast(${toolValue(key)} as bigint)`;

export function toolObject(s: GeneralServerStatements, keys: string[]) {
  s.throwErrorIf(
    sql`json_typeof(p_input) is distinct from 'object'`,
    sql.lit`Provide a JSON object.`,
  );
  s.throwErrorIf(
    sql`exists(select 1 from json.object_each(p_input) f where f.key not in (${
      keys.map((k) => sql.lit(k))
    }))`,
    sql.lit`Unsupported input field.`,
  );
}

export function toolInteger(
  s: GeneralServerStatements,
  key: string,
  required = false,
) {
  const value = toolValue(key);
  s.throwErrorIf(
    sql`(${required} and ${value} is null) or (${value} is not null and (
    json_typeof(p_input->${sql.lit(key)}) <> 'number' or ${toolId(key)} is null
    or ${toolId(key)} < 0 or try_cast(${value} as double) <> ${
      toolId(key)
    }::double))`,
    sql.lit(
      `${key} must be a nonnegative integer${required ? "" : " or null"}.`,
    ),
  );
}

export function toolString(
  s: GeneralServerStatements,
  key: string,
  max: number,
  required = false,
) {
  s.throwErrorIf(
    sql`(${required} and nullif(trim(${toolValue(key)}), '') is null)
    or (${toolValue(key)} is not null and (json_typeof(p_input->${
      sql.lit(key)
    }) <> 'string' or length(${toolValue(key)}) > ${max}))`,
    sql.lit(
      `${key} must be ${
        required ? "a nonempty" : "a"
      } string of at most ${max} characters.`,
    ),
  );
}

export function toolBoolean(s: GeneralServerStatements, key: string) {
  s.throwErrorIf(
    sql`p_input ? ${sql.lit(key)} and json_typeof(p_input->${
      sql.lit(key)
    }) is distinct from 'boolean'`,
    sql.lit(`${key} must be true or false.`),
  );
}

export function toolPage(s: GeneralServerStatements) {
  toolInteger(s, "offset");
  toolInteger(s, "limit");
  s.throwErrorIf(
    sql`coalesce(${toolId("limit")}, 50) not between 1 and 100`,
    sql.lit`limit must be between 1 and 100.`,
  );
  s.defScalar("tool_offset", sql`coalesce(${toolId("offset")}, 0)`);
  s.defScalar("tool_limit", sql`coalesce(${toolId("limit")}, 50)`);
}

/** Small caller-transaction procedures with execution-time authorization. */
export function blockToolset(namespace: string, permission: string) {
  if (!permission.trim()) {
    throw new Error(`${namespace} Spark requires an explicit permission.`);
  }
  const register = (
    name: string,
    body: (s: GeneralServerStatements) => void,
  ) => {
    const procedureName = `${namespace}_spark_${name}`;
    system.storedProcedure({
      name: procedureName,
      transaction: "caller",
      inputScalars: [{ name: "p_input", type: "Json" }],
      outputScalars: [{ name: "tool_output", type: "Json" }],
      procedure: (s) => {
        s.throwErrorIf(
          sql`current_user is null or not exists(select 1 from db.sys_users where id = current_user and not disabled) or ${
            currentUserHasPermission(sql.lit(permission))
          } is not true`,
          sql.lit`You do not have permission to use this capability.`,
        );
        body(s);
      },
    });
    return procedureName;
  };
  return {
    read(
      name: string,
      description: string,
      inputType: string,
      body: (s: GeneralServerStatements) => void,
    ): SparkFunction {
      const proc = register(name, body);
      return {
        name,
        description,
        inputType,
        procedure: (s) => {
          s.callStoredProcedure(proc, {
            inputScalars: { p_input: sql`function_input` },
            outputScalars: { tool_output: "block_tool_result" },
          });
          s.return(sql`block_tool_result`);
        },
      };
    },
    action(
      name: string,
      description: string,
      inputType: string,
      body: (s: GeneralServerStatements) => void,
      external?: boolean,
      validateUndo?: SparkAction["validateUndo"],
    ): SparkAction {
      const proc = register(name, body);
      return {
        name,
        description,
        inputType,
        mode: external ? "approval" : "reversible",
        validateUndo,
        ...(external
          ? {
            danger: "external" as const,
            approvalUi: ({ input }: { input: import("std/sql_utils").Sql }) => (
              <div>
                <p>{description}</p>
                <pre>{sql`${input}::string`}</pre>
              </div>
            ),
          }
          : {}),
        procedure: (s) => {
          // Approval reactors run without an ambient user; Spark supplies the
          // trusted conversation owner separately for both action modes.
          s.defScalar("block_tool_previous_user", sql`current_user`);
          s.setCurrentUser(sql`action_sys_user_id`);
          s.try({
            body: (s) => {
              s.callStoredProcedure(proc, {
                inputScalars: { p_input: sql`action_input` },
                outputScalars: { tool_output: "block_tool_result" },
              });
              s.setScalar("action_result", sql`block_tool_result::string`);
            },
            errorName: "block_tool_error",
            catch: (s) => rethrowSparkActionError(s, "block_tool_error"),
            finally: (s) => s.setCurrentUser(sql`block_tool_previous_user`),
          });
        },
      };
    },
  };
}
