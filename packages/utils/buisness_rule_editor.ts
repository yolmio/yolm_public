import { sql } from "../std/sql_utils";
import type { AnyExpr } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import { system } from "std/system";
import type { HelperFieldType } from "std/system";
import * as YolmGenApi from "std/yolm_gen_api";

interface DecisionTable {
  inputs: Record<string, HelperFieldType>;
  outputs: Record<string, HelperFieldType>;
  calculateFields?: Record<string, HelperFieldType>;
}

interface BuisnessRuleEditorProps {
  name: string;
  decisionTableConfig: DecisionTable;
}

export function loadDecisionTable(props: BuisnessRuleEditorProps) {
  const { name, decisionTableConfig } = props;
  const relativeJsonPath = `decision_tables/${name}.json`;
  const fileExists = YolmGenApi.existsSystemFile(relativeJsonPath);
  system.addDecisionTable({
    name,
    path: `${name}.json`,
  });

  if (!fileExists) {
    YolmGenApi.writeSystemTextFile(
      relativeJsonPath,
      JSON.stringify({ ...props, config: {} }, null, 2),
    );
  }
  // Check if the decision table configuration has changed
  if (fileExists) {
    const existingConfigText = YolmGenApi.loadSystemTextFile(relativeJsonPath);
    const existingConfig = JSON.parse(existingConfigText);
    const configChanged = JSON.stringify(existingConfig.decisionTableConfig) !==
        JSON.stringify(decisionTableConfig) || existingConfig.name !== name;

    if (configChanged) {
      // Update the file with new configuration while preserving existing rules
      YolmGenApi.writeSystemTextFile(
        relativeJsonPath,
        JSON.stringify(
          {
            name,
            decisionTableConfig,
            config: existingConfig.config || {},
          },
          null,
          2,
        ),
      );
    }
  }
  const ruleJsonText = YolmGenApi.loadSystemTextFile(relativeJsonPath);
  const ruleJson = JSON.parse(ruleJsonText);
  return {
    call: (
      s: DomStatements,
      opts: {
        inputValues: Record<string, AnyExpr>;
        outputs: string[];
        calculateFields?: Record<string, AnyExpr>;
      },
    ) => {
      for (const [name, type] of Object.entries(decisionTableConfig.outputs)) {
        s.defScalar(name, {
          type,
        });
      }
      s.block("decision_table", (s) => {
        for (const [name, type] of Object.entries(decisionTableConfig.inputs)) {
          s.defScalar(name, {
            type,
          });
        }
        if (decisionTableConfig.calculateFields && opts.calculateFields) {
          for (
            const [name, type] of Object.entries(
              decisionTableConfig.calculateFields,
            )
          ) {
            s.defScalar(name, {
              type,
            });
          }
          for (const [name, value] of Object.entries(opts.calculateFields)) {
            s.setScalar(name, value);
          }
        }
        for (const [name, value] of Object.entries(opts.inputValues)) {
          s.setScalar(name, value);
        }
        if (Object.keys(ruleJson.config).length > 0) {
          getDecision(s, ruleJson.config);
        }
      });
    },
  };
}

interface GetDecisionProps {
  columns: Array<{
    id: number;
    column_name: string;
    column_type: "condition" | "result";
    column_order: string;
    data_type: string;
    column_variable: string;
  }>;
  rows: Array<{
    id: number;
    row_order: string;
    is_active: boolean;
  }>;
  cells: Array<{
    id: number;
    row_id: number;
    column_id: number;
    cell_expr: string;
    operator: string;
  }>;
}
function getDecision(_s: DomStatements, _opts: GetDecisionProps) {
  const { rows, cells, columns } = _opts;
  for (const row of rows.filter((r) => r.is_active)) {
    const conditionCells = cells.filter((cell) => {
      const column = columns.find((col) => col.id === cell.column_id);
      return (
        cell.row_id === row.id && column && column.column_type === "condition"
      );
    });
    _s.defScalar(
      "condition_result",
      sql.and(
        ...conditionCells.map((cell) => {
          const column = columns.find((col) => col.id === cell.column_id);
          if (!column) {
            return sql.false;
          }
          return evaluateExpr(
            column.column_variable,
            cell.operator,
            cell.cell_expr,
          );
        }),
      ),
    );
    const resultCells = cells.filter((cell) => {
      const column = columns.find((col) => col.id === cell.column_id);
      return (
        cell.row_id === row.id && column && column.column_type === "result"
      );
    });
    resultCells.map((cell) => {
      const column = columns.find((col) => col.id === cell.column_id);
      if (!column) {
        return;
      }
      _s.if(sql`condition_result`, (s) => {
        s.setScalar(column.column_variable, sql(cell.cell_expr));
      });
    });
  }
}

function evaluateExpr(columnVariable: string, operator: string, expr: string) {
  switch (operator) {
    case "=":
      return sql`${sql(columnVariable)} = (${sql(expr)})`;
    case "!=":
      return sql`${sql(columnVariable)} != (${sql(expr)})`;
    case ">":
      return sql`${sql(columnVariable)} > (${sql(expr)})`;
    case ">=":
      return sql`${sql(columnVariable)} >= (${sql(expr)})`;
    case "<":
      return sql`${sql(columnVariable)} < (${sql(expr)})`;
    case "<=":
      return sql`${sql(columnVariable)} <= (${sql(expr)})`;
    default:
      return sql.true;
  }
}
