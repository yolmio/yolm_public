import { Alert } from "components/alert";
import { ActionButton } from "std/action_button";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { ChipButton } from "components/chip_button";
import { Checkbox } from "components/checkbox";
import { CircularProgress } from "components/circular_progress";
import { CollapseControl } from "components/collapse_component";
import { Divider } from "components/divider";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { Snackbar } from "components/snackbar";
import { SwitchControl } from "components/switch";
import { Table } from "components/table";
import { Tabs } from "components/tabs";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import type { BooleanExpr, Sql } from "../std/sql_utils";
import { sql, valuesRow } from "../std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import { createStyles, getVariantStyle } from "std/style_utils";
import { system } from "std/system";
import { Each, Route, Show } from "std/ui";
import type { Node } from "std/ui";
import { Data } from "std/data";

const styles = createStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    lg: { flexDirection: "row" },
  },
  schemaWrapper: {
    height: "100%",
    width: "100%",
    position: "relative",
    borderRight: "1px solid",
    borderColor: "divider",
    flexShrink: 0,
    order: 1,
    lg: { width: 410, order: 0 },
  },
  tableRow: {
    display: "flex",
    gap: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  menuIconButton: { maxHeight: "5%" },
  schema: {
    position: "absolute",
    inset: 0,
    px: 2,
    py: 2,
    display: "flex",
    flexDirection: "column",
    gap: 1,

    lg: {
      overflowY: "auto",
    },
  },
  tableFields: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: "primary-50",
    dark: {
      backgroundColor: "primary-800",
    },
    p: 2,
  },
  viewFields: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: "secondary-50",
    dark: {
      backgroundColor: "secondary-800",
    },
    p: 2,
  },
  virtualFields: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: "info-50",
    dark: {
      backgroundColor: "info-800",
    },
    p: 2,
  },
  enumValues: {
    display: "flex",
    flexDirection: "column",
    backgroundColor: "primary-50",
    dark: {
      backgroundColor: "primary-800",
    },
    p: 2,
  },
  enumValue: {
    fontSize: "sm",
    py: 1,
    borderBottom: "1px solid",
    borderColor: "divider",
    alignItems: "center",
    width: "100%",
  },
  schemaField: {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    py: 1,
    borderBottom: "1px solid",
    borderColor: "divider",
    alignItems: "center",
  },
  tabs: {
    flexGrow: 1,
    py: 4,
    px: 2,
    lg: {
      overflowY: "auto",
    },
  },
  expandable: {
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    gap: 3,
    px: 2,
    py: 2,
    fontSize: "sm",
    fontWeight: "medium",
    textDecoration: "none",
    color: "text-secondary",
    borderRadius: "md",
    cursor: "pointer",
    "&:hover": {
      backgroundColor: "primary-50",
      dark: {
        backgroundColor: "primary-800",
      },
    },
    "&.active": {
      color: "primary-plain-color",
      backgroundColor: "primary-50",
      dark: {
        backgroundColor: "primary-800",
      },
    },
    "&:active": {
      backgroundColor: "primary-100",
      dark: {
        backgroundColor: "primary-700",
      },
    },
  },

  fieldName: {
    display: "block",
    fontSize: "sm",
  },
  notNullFieldName: {
    display: "flex",
    gap: 2,
  },
  fieldType: {
    display: "block",
    fontSize: "sm",
    color: "text-secondary",
  },
  virtualFieldExpr: {
    display: "block",
    fontSize: "xs",
    color: "text-tertiary",
    whiteSpace: "pre-wrap",
    fontFamily: "monospace",
    mt: 1,
  },
  txInfoText: {
    my: 2,
    fontSize: "sm",
  },
  txInfoCode: {
    my: 2,
    fontFamily: "monospace",
    fontSize: "sm",
  },
  tableCard: {
    p: 2,
    mb: 2,
    backgroundColor: "background-paper",
    borderRadius: "lg",
    boxShadow: "sm",
    borderColor: "divider",
    borderWidth: "1px",
    borderStyle: "solid",
    minWidth: "100%",
  },
  viewCard: {
    p: 2,
    mb: 2,
    backgroundColor: "background-paper",
    borderRadius: "lg",
    boxShadow: "sm",
    borderColor: "divider",
    borderWidth: "1px",
    borderStyle: "solid",
    minWidth: "100%",
  },
  tableNameDisplay: {
    display: "flex",
    gap: 2,
    alignItems: "flex-start",
    flexDirection: "column",
    mb: 2,
    ml: 2,
  },
  tableNameAndActions: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  tableName: {
    fontWeight: "semibold",
    cursor: "pointer",
    color: "text-primary",
    "&:hover": {
      color: "primary-500",
    },
  },
  viewName: {
    fontWeight: "semibold",
    cursor: "pointer",
    color: "text-primary",
    "&:hover": {
      color: "secondary-500",
    },
  },
  fieldCopy: {
    cursor: "pointer",
    color: "text-primary",
    "&:hover": {
      color: "primary-500",
    },
  },
  virtualFieldCopy: {
    cursor: "pointer",
    color: "text-primary",
    "&:hover": {
      color: "info-500",
    },
  },
  viewFieldCopy: {
    cursor: "pointer",
    color: "text-primary",
    "&:hover": {
      color: "secondary-500",
    },
  },
  foreignKeys: {
    mt: 2,
    ml: 2,
  },
  fkTable: {
    fontSize: "sm",
    color: "neutral-500",
    alignItems: "center",
  },
  fkRow: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    color: "text-secondary",
    fontSize: "sm",
  },
  queryTextarea: {
    minHeight: "100px",
    borderRadius: "md",
    borderColor: "divider",
  },
  queryButtons: { display: "flex", gap: 2, mt: 2, flexWrap: "wrap" },
  transactionInspector: {
    pt: 4,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  transactionSummaryGrid: {
    display: "grid",
    gap: 2,
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  },
  transactionOpsTable: {
    width: "100%",
    mt: 2,
    borderRadius: "md",
    border: "1px solid",
    borderColor: "divider",
    tableLayout: "auto",
  },
  transactionOpsTableHeader: {
    padding: 2,
    backgroundColor: "primary-50",
    color: "text-primary",
    whiteSpace: "nowrap",
  },
  transactionOpsCell: {
    padding: 2,
    borderTop: "1px solid",
    borderColor: "divider",
    whiteSpace: "nowrap",
  },
  queryHistory: { display: "flex", flexDirection: "column", gap: 2 },
  queryTab: {
    pt: 4,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  queryHistoryItem: {
    backgroundColor: "divider",
    borderRadius: "md",
    p: 2,
    "&:hover": getVariantStyle("soft", "neutral", "hover"),
  },
  queryResults: {
    width: "100%",
    height: "100%",
    position: "relative",
    overflowX: "auto",
    overflowY: "auto",
  },
  queryResultsTable: {
    width: "max-content",
    mt: 4,
    borderRadius: "md",
    border: "1px solid",
    borderColor: "divider",
    tableLayout: "fixed",
    minWidth: "100%",
  },
  queryResultsTableHeader: {
    padding: 2,
    backgroundColor: "primary-50",
    color: "text-primary",
    whiteSpace: "nowrap",
    width: "auto",
    maxWidth: "none",
    overflow: "visible",
    textOverflow: "clip",
  },
  sectionHeader: {
    mt: 6,
    mb: 2,
  },
});

function errorState(s: StateStatements) {
  s.defScalar("err_type", {
    type: { type: "Enum", enum: "sys_error_type" },
    expr: sql.null,
    allowNoRead: true,
  });
  s.defScalar("err_message", {
    type: { type: "String", maxLength: 2000 },
    expr: sql.null,
    allowNoRead: true,
  });
  s.defScalar("err_description", {
    type: { type: "String", maxLength: 2000 },
    expr: sql.null,
    allowNoRead: true,
  });
}

function DisplayError() {
  return (
    <Show when={sql`err_type is not null`}>
      <div sx={{ maxWidth: 400 }}>
        <Alert startIcon="Report" color="danger">
          {" "}
          {sql`'Error Type: ' || err_type`}
        </Alert>
        <Typography>{sql`err_message`}</Typography>
        <Typography>{sql`err_description`}</Typography>
      </div>
    </Show>
  );
}

function setError(s: DomStatements, record: Sql) {
  s.setScalar("ui.err_type", sql`${record}.type`);
  s.setScalar("ui.err_message", sql`${record}.message`);
  s.setScalar("ui.err_description", sql`${record}.description`);
}

function setErrorToNull(s: DomStatements) {
  s.setScalar("ui.err_type", sql.null);
  s.setScalar("ui.err_message", sql.null);
  s.setScalar("ui.err_description", sql.null);
}

const formatBytes = (bytesExpr: ReturnType<typeof sql>) =>
  sql`
  case
    when ${bytesExpr} >= 1073741824 then
      format.decimal(${bytesExpr} / 1073741824.0, minimum_fraction_digits => 1, maximum_fraction_digits => 1) || ' GB'
    when ${bytesExpr} >= 1048576 then
      format.decimal(${bytesExpr} / 1048576.0, minimum_fraction_digits => 1, maximum_fraction_digits => 1) || ' MB'
    when ${bytesExpr} >= 1024 then
      format.decimal(${bytesExpr} / 1024.0, minimum_fraction_digits => 1, maximum_fraction_digits => 1) || ' KB'
    else format.decimal(${bytesExpr}) || ' bytes'
  end
`;

const formatDurationNs = (nsExpr: ReturnType<typeof sql>) =>
  sql`
  case
    when ${nsExpr} >= 1000000000 then
      format.decimal(${nsExpr} / 1000000000.0, minimum_fraction_digits => 2, maximum_fraction_digits => 2) || ' s'
    when ${nsExpr} >= 1000000 then
      format.decimal(${nsExpr} / 1000000.0, minimum_fraction_digits => 1, maximum_fraction_digits => 1) || ' ms'
    when ${nsExpr} >= 1000 then
      format.decimal(${nsExpr} / 1000.0, minimum_fraction_digits => 1, maximum_fraction_digits => 1) || ' us'
    else '<1 us'
  end
`;

const formatCount = (countExpr: ReturnType<typeof sql>) =>
  sql`format.decimal(${countExpr})`;

function queueQueryRun(
  s: DomStatements,
  queryExpr: ReturnType<typeof sql>,
  opts?: { explainOnly?: boolean },
) {
  s.setScalar("query_explain_only", opts?.explainOnly ?? false);
  s.setScalar("ui.query_to_run", queryExpr);
  s.increment("ui.query_run_key");
  s.commitUiTreeChanges();
}

function QueryMetricCard(
  { label, value, note }: {
    label: string;
    value: ReturnType<typeof sql>;
    note?: string;
  },
) {
  return (
    <div className="p-3 border border-divider rounded-md bg-level1">
      <Typography level="body-xs" className="text-tertiary mb-1">
        {label}
      </Typography>
      <Typography level="title-md">{value}</Typography>
      {note
        ? (
          <Typography level="body-xs" className="text-tertiary mt-1">
            {note}
          </Typography>
        )
        : null}
    </div>
  );
}

function TransactionInspectorResults() {
  return (
    <Data
      watch={[sql`transaction_inspect_key`, sql`undo_refresh_key`]}
      statusScalar="transaction_inspect_status"
      hasDataScalar="transaction_inspect_has_data"
      pendingFallback={
        <Alert
          startDecorator={<CircularProgress size="sm" />}
          color="neutral"
          variant="soft"
        >
          Loading transaction...
        </Alert>
      }
      procedure={(s) => {
        s.defRecord(
          "transaction_summary",
          sql`
            select
              inspected_tx_id as tx_id,
              (select min(tx_timestamp) from db.tx_op where tx_id = inspected_tx_id) as tx_timestamp,
              (select tx_creator from db.tx_op where tx_id = inspected_tx_id limit 1) as tx_creator,
              (select count(*) from db.tx_op where tx_id = inspected_tx_id) as op_count,
              (select count(*) from db.tx_op where tx_id = inspected_tx_id and kind = 'insert') as insert_count,
              (select count(*) from db.tx_op where tx_id = inspected_tx_id and kind = 'delete') as delete_count,
              (select count(*) from db.tx_op where tx_id = inspected_tx_id and kind = 'restore') as restore_count,
              (select count(*) from db.tx_op where tx_id = inspected_tx_id and kind = 'update') as update_count,
              (select count(*) from db.tx_op where tx_id = inspected_tx_id and kind = 'skip') as skip_count,
              undo_status,
              undo_affected_records as affected_records,
              undo_blocking_tx_id as blocking_tx_id,
              undo_blocking_table as blocking_table,
              undo_blocking_record_id as blocking_record_id,
              undo_reason
          `,
        );
        s.defTable(
          "transaction_ops",
          sql`
            select
              sequence_id,
              table,
              kind,
              record_id,
              undo_status = 'Ready' as supported,
              case
                when kind = 'insert' then 'Undo will delete this record'
                when kind = 'delete' then 'Undo will restore this record'
                when kind = 'restore' then 'Undo will delete this restored record'
                when kind = 'update' then 'Undo will restore the previous field values'
                when kind = 'skip' then 'Undo will account for this compaction marker'
                else 'Undo will reverse this operation'
              end as action_preview
            from db.tx_op
            where tx_id = inspected_tx_id
            order by sequence_id
          `,
        );
      }}
    >
      <Show
        when={sql`transaction_inspect_status in ('requested', 'delayed', 'fallback_triggered') and transaction_inspect_has_data`}
      >
        <Alert
          startDecorator={<CircularProgress size="sm" />}
          color="neutral"
          variant="soft"
          className="mb-3"
        >
          Loading transaction...
        </Alert>
      </Show>
      <Show
        when={sql`transaction_summary.op_count = 0`}
        fallback={<TransactionInspectorDetails />}
      >
        <Alert startIcon="Info" color="neutral" variant="soft">
          No transaction found for id {sql`inspected_tx_id`}
        </Alert>
      </Show>
    </Data>
  );
}

function TransactionInspectorDetails() {
  const undoDisabled =
    sql`transaction_summary.op_count = 0 or transaction_summary.undo_status != 'Ready'`;

  return (
    <div sx={styles.transactionInspector}>
      <div className="flex flex-wrap items-center gap-2">
        <Typography level="h4">
          Transaction {sql`transaction_summary.tx_id`}
        </Typography>
        <Show
          when={sql`transaction_summary.undo_status = 'Ready'`}
          fallback={
            <Chip color="warning" variant="soft" size="sm">
              {sql`case when transaction_summary.undo_status = 'Blocked' then 'Undo blocked' else 'Undo unavailable' end`}
            </Chip>
          }
        >
          <Chip color="success" variant="soft" size="sm">
            Undoable
          </Chip>
        </Show>
      </div>

      <div sx={styles.transactionSummaryGrid}>
        <QueryMetricCard
          label="Timestamp"
          value={sql`format.date(transaction_summary.tx_timestamp, '%Y-%m-%d %H:%M:%S')`}
        />
        <QueryMetricCard
          label="Creator"
          value={sql`case when transaction_summary.tx_creator is null then 'None' else cast(transaction_summary.tx_creator as string) end`}
        />
        <QueryMetricCard
          label="Operations"
          value={formatCount(sql`transaction_summary.op_count`)}
        />
        <QueryMetricCard
          label="Inserts"
          value={formatCount(sql`transaction_summary.insert_count`)}
        />
        <QueryMetricCard
          label="Deletes"
          value={formatCount(sql`transaction_summary.delete_count`)}
        />
        <QueryMetricCard
          label="Restores"
          value={formatCount(sql`transaction_summary.restore_count`)}
        />
        <QueryMetricCard
          label="Updates"
          value={formatCount(sql`transaction_summary.update_count`)}
        />
        <QueryMetricCard
          label="Skips"
          value={formatCount(sql`transaction_summary.skip_count`)}
        />
        <QueryMetricCard
          label="Affected records"
          value={formatCount(sql`transaction_summary.affected_records`)}
        />
      </div>

      <div>
        <div sx={styles.queryButtons}>
          <ActionButton
            startIcon="Undo"
            disabled={undoDisabled}
            action={(s) => {
              s.startTransaction();
              s.undoTransactions(
                sql`select cast(inspected_tx_id as bigint) as tx_id`,
              );
              s.commitTransaction();
            }}
            refetch={false}
            afterSuccessClient={(s) => {
              s.try({
                body: (s) => {
                  s.server((s) => {
                    s.analyzeUndoTransactions(
                      sql`select cast(ui.inspected_tx_id as bigint) as tx_id`,
                      "post_undo_analysis",
                    );
                    s.setScalar(
                      "ui.undo_status",
                      sql`(select status from post_undo_analysis)`,
                    );
                    s.setScalar(
                      "ui.undo_affected_records",
                      sql`(select affected_records from post_undo_analysis)`,
                    );
                    s.setScalar(
                      "ui.undo_blocking_tx_id",
                      sql`(select blocking_tx_id from post_undo_analysis)`,
                    );
                    s.setScalar(
                      "ui.undo_blocking_table",
                      sql`coalesce((select blocking_table from post_undo_analysis), '')`,
                    );
                    s.setScalar(
                      "ui.undo_blocking_record_id",
                      sql`(select blocking_record_id from post_undo_analysis)`,
                    );
                    s.setScalar(
                      "ui.undo_reason",
                      sql`coalesce((select reason from post_undo_analysis), '')`,
                    );
                  });
                },
                catch: (s) => {
                  s.setScalar("undo_status", sql.lit`Unavailable`);
                  s.setScalar("undo_affected_records", 0);
                  s.setScalar("undo_blocking_tx_id", sql.null);
                  s.setScalar("undo_blocking_table", sql.lit``);
                  s.setScalar("undo_blocking_record_id", sql.null);
                  s.setScalar(
                    "undo_reason",
                    sql
                      .lit`Undo succeeded, but status refresh failed. Inspect the transaction again to refresh.`,
                  );
                },
                finally: (s) => s.increment("undo_refresh_key"),
              });
            }}
            successMessage={sql`'Successfully undid transaction ' || cast(transaction_summary.tx_id as string)`}
            confirm={{
              description:
                "This will atomically reverse this transaction using its retained database history.",
              confirmText: "Undo transaction",
            }}
          >
            Undo transaction
          </ActionButton>
        </div>
        <Show when={sql`transaction_summary.undo_status != 'Ready'`}>
          <Typography level="body-sm" className="text-secondary mt-2">
            {sql`coalesce(transaction_summary.undo_reason, 'This transaction cannot currently be undone.')`}
          </Typography>
        </Show>
      </div>

      <div sx={styles.queryResults}>
        <Table sx={styles.transactionOpsTable}>
          <thead>
            <tr>
              <th sx={styles.transactionOpsTableHeader}>Sequence</th>
              <th sx={styles.transactionOpsTableHeader}>Table</th>
              <th sx={styles.transactionOpsTableHeader}>Kind</th>
              <th sx={styles.transactionOpsTableHeader}>Record</th>
              <th sx={styles.transactionOpsTableHeader}>Undo preview</th>
            </tr>
          </thead>
          <tbody>
            <Each table="transaction_ops" recordName="tx_op">
              <tr
                sx={{
                  "&:hover": {
                    backgroundColor: "primary-50",
                    dark: {
                      backgroundColor: "primary-800",
                    },
                  },
                }}
              >
                <td sx={styles.transactionOpsCell}>
                  {sql`tx_op.sequence_id`}
                </td>
                <td sx={styles.transactionOpsCell}>{sql`tx_op.table`}</td>
                <td sx={styles.transactionOpsCell}>
                  <Show
                    when={sql`tx_op.supported`}
                    fallback={
                      <Chip color="warning" variant="soft" size="sm">
                        {sql`tx_op.kind`}
                      </Chip>
                    }
                  >
                    <Chip color="neutral" variant="soft" size="sm">
                      {sql`tx_op.kind`}
                    </Chip>
                  </Show>
                </td>
                <td sx={styles.transactionOpsCell}>{sql`tx_op.record_id`}</td>
                <td sx={styles.transactionOpsCell}>
                  {sql`tx_op.action_preview`}
                </td>
              </tr>
            </Each>
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function UndoSingleTransaction() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("tx_id", sql.lit``);
        s.defScalar("inspected_tx_id", { type: "BigUint" });
        s.defScalar("transaction_inspect_key", 0);
        s.defScalar("undo_refresh_key", 0);
        s.defScalar("transaction_inspect_status", sql.lit``);
        s.defScalar("transaction_inspect_has_data", false);
        s.defScalar("undo_status", sql.lit``);
        s.defScalar("undo_affected_records", { type: "BigUint" });
        s.defScalar("undo_blocking_tx_id", { type: "BigUint" });
        s.defScalar("undo_blocking_table", sql.lit``);
        s.defScalar("undo_blocking_record_id", { type: "BigUint" });
        s.defScalar("undo_reason", sql.lit``);
        errorState(s);
      }}
    >
      <div sx={styles.transactionInspector}>
        <Input
          bindScalar="tx_id"
          placeholder="Transaction id"
        />
        <div sx={styles.queryButtons}>
          <ActionButton
            startIcon="Search"
            disabled={sql`try_cast(tx_id as bigint) is null`}
            refetch={false}
            action={(s) => {
              s.analyzeUndoTransactions(
                sql`select cast(ui.tx_id as bigint) as tx_id`,
                "undo_analysis",
              );
              s.setScalar(
                "ui.inspected_tx_id",
                sql`cast(ui.tx_id as bigint)`,
              );
              s.setScalar(
                "ui.undo_status",
                sql`(select status from undo_analysis)`,
              );
              s.setScalar(
                "ui.undo_affected_records",
                sql`(select affected_records from undo_analysis)`,
              );
              s.setScalar(
                "ui.undo_blocking_tx_id",
                sql`(select blocking_tx_id from undo_analysis)`,
              );
              s.setScalar(
                "ui.undo_blocking_table",
                sql`coalesce((select blocking_table from undo_analysis), '')`,
              );
              s.setScalar(
                "ui.undo_blocking_record_id",
                sql`(select blocking_record_id from undo_analysis)`,
              );
              s.setScalar(
                "ui.undo_reason",
                sql`coalesce((select reason from undo_analysis), '')`,
              );
            }}
            afterSuccessClient={(s) => s.increment("transaction_inspect_key")}
          >
            Inspect
          </ActionButton>
        </div>
        <Show when={sql`tx_id != '' and try_cast(tx_id as bigint) is null`}>
          <Alert startIcon="Warning" color="warning" variant="soft">
            Enter a valid transaction id.
          </Alert>
        </Show>
        <Show when={sql`inspected_tx_id is not null`}>
          <TransactionInspectorResults />
        </Show>
      </div>
    </Data>
  );
}

function transactionIdTokens(input: Sql) {
  return sql`
    select trim(value) as value
    from string.split(
      replace(
        replace(
          replace(
            replace(${input}, chr(13), ','),
            chr(10), ','
          ),
          chr(9), ','
        ),
        ' ', ','
      ),
      ','
    )
    where trim(value) != ''
  `;
}

function transactionIdSet(input: Sql) {
  return sql`
    select distinct cast(value as bigint) as tx_id
    from (${transactionIdTokens(input)}) transaction_id_token
    where try_cast(value as bigint) is not null
      and cast(value as bigint) >= 0
    order by tx_id
  `;
}

function TransactionSetInspectorResults() {
  return (
    <Data
      watch={[sql`transaction_set_inspect_key`]}
      procedure={(s) => {
        s.defTable(
          "transaction_set_analysis",
          sql`
            select
              cast(value->>'tx_id' as bigint) as tx_id,
              value->>'status' as status,
              cast(value->>'affected_records' as bigint) as affected_records,
              nullif(value->>'reason', '') as reason
            from json.array_each(undo_set_analysis_json::json)
          `,
        );
        s.defRecord(
          "transaction_set_summary",
          sql`
            select
              count(*) as tx_count,
              count(*) filter (where status = 'Ready') as ready_count,
              coalesce(sum(affected_records), 0) as affected_records
            from transaction_set_analysis
          `,
        );
        s.defTable(
          "transaction_set_rows",
          sql`
            select
              analysis.tx_id,
              analysis.status,
              analysis.affected_records,
              analysis.reason,
              count(operation.sequence_id) as operation_count,
              min(operation.tx_timestamp) as tx_timestamp,
              (select tx_creator
               from db.tx_op
               where tx_id = analysis.tx_id
               limit 1) as tx_creator
            from transaction_set_analysis analysis
            left join db.tx_op operation on operation.tx_id = analysis.tx_id
            group by
              analysis.tx_id,
              analysis.status,
              analysis.affected_records,
              analysis.reason
            order by analysis.tx_id
          `,
        );
      }}
    >
      <div sx={styles.transactionInspector}>
        <div className="flex flex-wrap items-center gap-2">
          <Typography level="h4">
            {sql`transaction_set_summary.tx_count || ' transactions'`}
          </Typography>
          <Show
            when={sql`transaction_set_summary.tx_count > 0 and transaction_set_summary.ready_count = transaction_set_summary.tx_count`}
            fallback={
              <Chip color="warning" variant="soft" size="sm">
                Set cannot be undone
              </Chip>
            }
          >
            <Chip color="success" variant="soft" size="sm">
              Entire set is undoable
            </Chip>
          </Show>
        </div>

        <div sx={styles.transactionSummaryGrid}>
          <QueryMetricCard
            label="Transactions"
            value={formatCount(sql`transaction_set_summary.tx_count`)}
          />
          <QueryMetricCard
            label="Ready"
            value={formatCount(sql`transaction_set_summary.ready_count`)}
          />
          <QueryMetricCard
            label="Affected records"
            value={formatCount(sql`transaction_set_summary.affected_records`)}
          />
        </div>

        <ActionButton
          startIcon="Undo"
          disabled={sql`transaction_set_summary.tx_count = 0 or transaction_set_summary.ready_count != transaction_set_summary.tx_count`}
          action={(s) => {
            s.startTransaction();
            s.undoTransactions(transactionIdSet(sql`ui.inspected_tx_ids`));
            s.commitTransaction();
          }}
          refetch={false}
          afterSuccessClient={(s) => {
            s.try({
              body: (s) => {
                s.server((s) => {
                  s.analyzeUndoTransactions(
                    transactionIdSet(sql`ui.inspected_tx_ids`),
                    "post_undo_analysis",
                  );
                  s.setScalar(
                    "ui.undo_set_analysis_json",
                    sql`coalesce((
                      select json_array_agg(json_build_object(
                        'tx_id', tx_id,
                        'status', status,
                        'affected_records', affected_records,
                        'reason', reason
                      ))::string
                      from post_undo_analysis
                    ), '[]')`,
                  );
                });
              },
              catch: (s) => {
                s.setScalar(
                  "undo_set_analysis_json",
                  sql`coalesce((
                    select json_array_agg(json_build_object(
                      'tx_id', tx_id,
                      'status', 'Unavailable',
                      'affected_records', 0,
                      'reason', 'Undo succeeded, but status refresh failed. Analyze the set again to refresh.'
                    ))::string
                    from (${
                    transactionIdSet(sql`inspected_tx_ids`)
                  }) transaction_ids
                  ), '[]')`,
                );
              },
              finally: (s) => s.increment("transaction_set_inspect_key"),
            });
          }}
          successMessage="Transactions undone successfully"
          confirm={{
            description:
              sql`'This will atomically undo ' || transaction_set_summary.tx_count || ' transactions using retained database history.'`,
            confirmText: "Undo transaction set",
          }}
        >
          {sql`'Undo ' || transaction_set_summary.tx_count || ' transactions'`}
        </ActionButton>

        <div sx={styles.queryResults}>
          <Table sx={styles.transactionOpsTable}>
            <thead>
              <tr>
                <th sx={styles.transactionOpsTableHeader}>Transaction</th>
                <th sx={styles.transactionOpsTableHeader}>Status</th>
                <th sx={styles.transactionOpsTableHeader}>Timestamp</th>
                <th sx={styles.transactionOpsTableHeader}>Creator</th>
                <th sx={styles.transactionOpsTableHeader}>Operations</th>
                <th sx={styles.transactionOpsTableHeader}>Affected</th>
                <th sx={styles.transactionOpsTableHeader}>Reason</th>
              </tr>
            </thead>
            <tbody>
              <Each table="transaction_set_rows" recordName="transaction">
                <tr>
                  <td sx={styles.transactionOpsCell}>
                    {sql`transaction.tx_id`}
                  </td>
                  <td sx={styles.transactionOpsCell}>
                    <Show
                      when={sql`transaction.status = 'Ready'`}
                      fallback={
                        <Chip color="warning" variant="soft" size="sm">
                          {sql`transaction.status`}
                        </Chip>
                      }
                    >
                      <Chip color="success" variant="soft" size="sm">
                        Ready
                      </Chip>
                    </Show>
                  </td>
                  <td sx={styles.transactionOpsCell}>
                    {sql`case when transaction.tx_timestamp is null then '-' else format.date(transaction.tx_timestamp, '%Y-%m-%d %H:%M:%S') end`}
                  </td>
                  <td sx={styles.transactionOpsCell}>
                    {sql`coalesce(cast(transaction.tx_creator as string), 'None')`}
                  </td>
                  <td sx={styles.transactionOpsCell}>
                    {sql`transaction.operation_count`}
                  </td>
                  <td sx={styles.transactionOpsCell}>
                    {sql`transaction.affected_records`}
                  </td>
                  <td sx={styles.transactionOpsCell}>
                    {sql`coalesce(transaction.reason, '-')`}
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </div>
      </div>
    </Data>
  );
}

function UndoTransactionSet() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("tx_ids", sql.lit``);
        s.defScalar("inspected_tx_ids", sql.lit``);
        s.defScalar("undo_set_analysis_json", sql.lit`[]`);
        s.defScalar("transaction_set_inspect_key", 0);
      }}
    >
      <div sx={styles.transactionInspector}>
        <Textarea
          bindScalar="tx_ids"
          rows={5}
          placeholder="Transaction IDs separated by commas, spaces, or new lines"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <ActionButton
          startIcon="Search"
          disabled={sql`trim(tx_ids) = ''`}
          refetch={false}
          action={(s) => {
            s.throwErrorIf(
              sql`exists (
                select 1
                from (${
                transactionIdTokens(sql`ui.tx_ids`)
              }) transaction_id_token
                where try_cast(value as bigint) is null
                   or cast(value as bigint) < 0
              )`,
              sql.lit`Every transaction ID must be a non-negative integer.`,
            );
            s.throwErrorIf(
              sql`not exists (${transactionIdSet(sql`ui.tx_ids`)})`,
              sql.lit`Enter at least one transaction ID.`,
            );
            s.analyzeUndoTransactions(
              transactionIdSet(sql`ui.tx_ids`),
              "undo_set_analysis",
            );
            s.setScalar(
              "ui.inspected_tx_ids",
              sql`(select string_agg(cast(tx_id as string), ',' order by tx_id) from undo_set_analysis)`,
            );
            s.setScalar(
              "ui.undo_set_analysis_json",
              sql`coalesce((
                select json_array_agg(json_build_object(
                  'tx_id', tx_id,
                  'status', status,
                  'affected_records', affected_records,
                  'reason', reason
                ))::string
                from undo_set_analysis
              ), '[]')`,
            );
          }}
          afterSuccessClient={(s) => s.increment("transaction_set_inspect_key")}
        >
          Analyze set
        </ActionButton>
        <Show when={sql`inspected_tx_ids != ''`}>
          <TransactionSetInspectorResults />
        </Show>
      </div>
    </Data>
  );
}

function UndoTxTab() {
  return (
    <Tabs defaultValue="single" size="sm">
      <Tabs.List>
        <Tabs.Tab value="single">Single transaction</Tabs.Tab>
        <Tabs.Tab value="set">Transaction set</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="single">
        <UndoSingleTransaction />
      </Tabs.Panel>
      <Tabs.Panel value="set">
        <UndoTransactionSet />
      </Tabs.Panel>
    </Tabs>
  );
}

function ModifyTab() {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("statement", sql.lit``);
        s.defScalar("tx_id", { type: "BigUint" });
        s.defScalar("modify_succeeded", false);
        s.defScalar("modify_running", false);
        errorState(s);
      }}
    >
      <div>
        <Textarea
          bindScalar="statement"
          rows={10}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          className="mt-4"
        />
        <div sx={styles.queryButtons}>
          <Button
            loading={sql`modify_running`}
            disabled={sql`modify_running or trim(statement) = ''`}
            onClick={(s) => {
              s.returnIf(sql`modify_running`);
              s.setScalar("modify_running", true);
              s.commitUiTreeChanges();
              s.try({
                body: (s) => {
                  s.server((s) => {
                    s.startTransaction();
                    s.dynamicModify(sql`ui.statement`);
                    s.commitTransaction("ui.tx_id");
                  });
                  s.setScalar("ui.modify_succeeded", true);
                  setErrorToNull(s);
                },
                errorName: "err",
                catch: (s) => {
                  s.setScalar("ui.modify_succeeded", false);
                  s.setScalar("ui.tx_id", sql.null);
                  setError(s, sql.ref("err"));
                },
                finally: (s) => {
                  s.setScalar("modify_running", false);
                },
              });
            }}
          >
            Run statement
          </Button>
        </div>
        <Show when={sql`tx_id is not null`}>
          <Alert startIcon="CheckCircle" color="success">
            Successfully ran statement. Transaction id is: {sql`tx_id`}
          </Alert>
        </Show>
        <Show when={sql`modify_succeeded and tx_id is null`}>
          <Alert startIcon="CheckCircle" color="success">
            Successfully ran statement. No rows were changed.
          </Alert>
        </Show>
        <DisplayError />
      </div>
    </Data>
  );
}

function QueryTab() {
  return (
    <Data
      local
      procedure={(s) => {
        errorState(s);
        s.defScalar("download_running", false);
        s.defScalar("query_results_status", sql.lit``);
        s.defScalar("query_results_has_data", false);
      }}
    >
      <div sx={styles.queryTab}>
        <Textarea
          bindScalar="query"
          rows={10}
          sx={styles.queryTextarea}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          onKeyDown={(s) => {
            s.if(
              sql`(event.key = 'Enter' and (event.ctrl_key or event.meta_key)) or event.key = 'F5'`,
              (s) => {
                s.event.preventDefault();
                setErrorToNull(s);
                queueQueryRun(s, sql`ui.query`);
                s.modify(
                  sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
                );
              },
            );
          }}
        />
        <div sx={styles.queryButtons}>
          <Checkbox
            variant="outlined"
            size="sm"
            checked={sql`query_include_explain`}
            label="Include explain"
            onChange={(s) => {
              s.setScalar(
                "query_include_explain",
                sql`not coalesce(query_include_explain, false)`,
              );
            }}
          />
          <Checkbox
            variant="outlined"
            size="sm"
            checked={sql`query_collect_metrics`}
            label="Collect metrics"
            onChange={(s) => {
              s.setScalar(
                "query_collect_metrics",
                sql`not coalesce(query_collect_metrics, false)`,
              );
            }}
          />
          <Checkbox
            variant="outlined"
            size="sm"
            checked={sql`query_skip_auto_row_cap`}
            label="Allow uncapped export"
            onChange={(s) => {
              s.setScalar(
                "query_skip_auto_row_cap",
                sql`not coalesce(query_skip_auto_row_cap, false)`,
              );
            }}
          />
          <Button
            loading={sql`query_results_status in ('requested', 'delayed', 'fallback_triggered')`}
            disabled={sql`query_results_status in ('requested', 'delayed', 'fallback_triggered')`}
            onClick={(s) => {
              setErrorToNull(s);
              queueQueryRun(s, sql`ui.query`);
              s.modify(
                sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
              );
            }}
          >
            Display results
          </Button>
          <Button
            color="neutral"
            variant="soft"
            loading={sql`query_results_status in ('requested', 'delayed', 'fallback_triggered')`}
            disabled={sql`query_results_status in ('requested', 'delayed', 'fallback_triggered')`}
            onClick={(s) => {
              setErrorToNull(s);
              queueQueryRun(s, sql`ui.query`, { explainOnly: true });
              s.modify(
                sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
              );
            }}
          >
            Explain
          </Button>
          <Button
            color="neutral"
            variant="soft"
            loading={sql`download_running`}
            disabled={sql`download_running`}
            onClick={(s) => {
              s.returnIf(sql`download_running`);
              setErrorToNull(s);
              s.setScalar("download_running", true);
              s.commitUiTreeChanges();
              s.try({
                body: (s) => {
                  s.downloadDynamicQueryCsv(
                    sql.lit`result.csv`,
                    sql`ui.query`,
                    {
                      skipAutoRowCap: sql`query_skip_auto_row_cap`,
                    },
                  );
                },
                errorName: "err",
                catch: (s) => {
                  setError(s, sql.ref("err"));
                },
                finally: (s) => {
                  s.setScalar("download_running", false);
                },
              });
            }}
          >
            Download query results
          </Button>
        </div>
        <DisplayError />
        <Show when={sql`query_to_run is not null`}>
          <QueryResults />
        </Show>
      </div>
    </Data>
  );
}
function QueryHistoryTab() {
  return (
    <Data
      local
      procedure={(s) => {
        errorState(s);
      }}
    >
      <div className="pt-4 h-full">
        <Show
          when={sql`exists(select 1 from query_history)`}
          fallback={
            <Typography level="h4" className="text-center text-neutral-300">
              No query history found
            </Typography>
          }
        >
          <div sx={styles.queryHistory}>
            <Typography level="h4" className="text-left text-neutral-500">
              Click on a query to re-run it
            </Typography>
            <Each table="query_history" recordName="query">
              <div
                sx={styles.queryHistoryItem}
                onClick={(s) => {
                  s.setScalar("query", sql`query.query`);
                  s.setScalar("selected_tab", sql.lit`query`);
                  queueQueryRun(s, sql`query.query`);
                }}
              >
                {sql`query.query`}
              </div>
            </Each>
          </div>
        </Show>
      </div>
    </Data>
  );
}

function QueryResults() {
  return (
    <Data
      watch={[sql`query_run_key`]}
      statusScalar="query_results_status"
      hasDataScalar="query_results_has_data"
      errorRecord="err"
      pendingFallback={
        <Alert
          startDecorator={<CircularProgress size="sm" />}
          color="neutral"
          variant="soft"
        >
          Querying...
        </Alert>
      }
      errorFallback={
        <Alert startIcon="Report" color="danger">
          {sql`'Failed to load query results. ' || coalesce(err.message, '') || coalesce(err.description, '')`}
        </Alert>
      }
      procedure={(s) => {
        s.defScalar("query_explain_text", {
          type: { type: "String", maxLength: 1000000 },
        });
        s.defScalar("query_metrics", { type: "Json" });
        s.setScalar("query_explain_text", sql.lit``);
        s.setScalar("query_metrics", sql`null::json`);
        s.if(sql`not query_explain_only`, (s) => {
          s.dynamicQuery({
            resultTable: "dyn_result",
            query: sql`query_to_run`,
            columnCount: Math.max(
              ...Object.values(system.db.tables).map(
                (t) =>
                  Object.keys(t.fields).length +
                  Object.keys(t.virtuals).length +
                  5,
              ),
            ),
            columnMetaTable: "meta",
            metricsScalar: "query_metrics_result",
          });
          s.if(sql`query_collect_metrics`, (s) => {
            s.setScalar("query_metrics", sql`query_metrics_result`);
          });
          s.defTable("meta_with_columns", {
            query:
              sql`select name, case when name = 'last_modified_by_tx' or name = 'created_by_tx' then false else true end as enabled from meta`,
            allowNoRead: true,
          });
        });
        s.if(sql`query_include_explain or query_explain_only`, (s) => {
          s.dynamicExplainQuery({
            query: sql`query_to_run`,
            resultScalar: "query_explain_text_result",
          });
          s.setScalar(
            "query_explain_text",
            sql`coalesce(query_explain_text_result, '')`,
          );
        });
      }}
    >
      <div sx={styles.queryResults}>
        <Show
          when={sql`query_results_status in ('requested', 'delayed', 'fallback_triggered') and query_results_has_data`}
        >
          <Alert
            startDecorator={<CircularProgress size="sm" />}
            color="neutral"
            variant="soft"
            className="mb-4"
          >
            Querying...
          </Alert>
        </Show>
        <Show when={sql`query_results_status = 'failed'`}>
          <Alert startIcon="Report" color="danger" className="mb-4">
            {sql`'Failed to load query results. ' || coalesce(err.message, '') || coalesce(err.description, '')`}
          </Alert>
        </Show>
        <Show when={sql`query_results_status != 'failed'`}>
          <Show when={sql`query_explain_text != ''`}>
            <div className="mb-4 border border-divider rounded-md overflow-hidden">
              <div className="bg-level1 px-3 py-2 border-b border-divider flex items-center justify-between gap-2">
                <Typography level="body-sm" className="font-medium">
                  Explain Plan
                </Typography>
                <Show when={sql`query_explain_only`}>
                  <Chip size="sm" variant="soft" color="neutral">
                    Explain only
                  </Chip>
                </Show>
              </div>
              <pre className="text-xs bg-level1 p-3 whitespace-pre-wrap break-words overflow-x-auto max-h-96">
                {sql`query_explain_text`}
              </pre>
            </div>
          </Show>
          <Show when={sql`query_metrics is not null`}>
            <div className="mb-4 border border-divider rounded-md overflow-hidden">
              <div className="bg-level1 px-3 py-2 border-b border-divider">
                <Typography level="body-sm" className="font-medium">
                  Execution Metrics
                </Typography>
              </div>
              <div className="p-3 space-y-4">
                <div>
                  <Typography level="body-xs" className="text-tertiary mb-2">
                    Timing
                  </Typography>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <QueryMetricCard
                      label="CPU Time"
                      value={formatDurationNs(
                        sql`coalesce((query_metrics->>'cpuTimeNs')::bigint, 0)`,
                      )}
                    />
                    <QueryMetricCard
                      label="Query Setup"
                      value={formatDurationNs(
                        sql`coalesce((query_metrics->>'querySetupTimeNs')::bigint, 0)`,
                      )}
                    />
                    <QueryMetricCard
                      label="Asset Load"
                      value={formatDurationNs(
                        sql`coalesce((query_metrics->>'loadAssetTimeNs')::bigint, 0)`,
                      )}
                    />
                    <QueryMetricCard
                      label="Data Loaded"
                      value={formatBytes(
                        sql`coalesce((query_metrics->>'bytesLoaded')::bigint, 0)`,
                      )}
                    />
                  </div>
                </div>
                <div>
                  <Typography level="body-xs" className="text-tertiary mb-2">
                    Access
                  </Typography>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <QueryMetricCard
                      label="Visible Blocks"
                      value={formatCount(
                        sql`coalesce((query_metrics->>'querySetupVisibleBlocks')::bigint, 0)`,
                      )}
                    />
                    <QueryMetricCard
                      label="Blocks Used"
                      value={formatCount(
                        sql`coalesce((query_metrics->>'blocksUsed')::bigint, 0)`,
                      )}
                    />
                    <QueryMetricCard
                      label="Blocks Pruned"
                      value={formatCount(
                        sql`coalesce((query_metrics->>'blocksPruned')::bigint, 0)`,
                      )}
                    />
                    <QueryMetricCard
                      label="Arena Memory"
                      value={formatBytes(
                        sql`coalesce((query_metrics->>'arenaBytesUsed')::bigint, 0)`,
                      )}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Show>
          <Show when={sql`not query_explain_only`}>
            <Typography
              level="title-md"
              className="text-left mt-2 mb-2 text-neutral-500"
            >
              Found {sql`(select count(*) from dyn_result)`}{" "}
              {sql`case when (select count(*) from dyn_result) = 1 then 'record' else 'records' end`}
            </Typography>
            <Each table="meta_with_columns" recordName="column">
              <ChipButton
                checkedVariation={{ color: "neutral" }}
                checked={sql`column.enabled`}
                aria-label="Toggle column visibility"
                variant="outlined"
                onClick={(s) => {
                  s.modify(
                    sql`update meta_with_columns set enabled = not enabled where name = column.name`,
                  );
                }}
                className="mr-2"
              >
                {sql`column.name`}
              </ChipButton>
            </Each>
            <Table sx={styles.queryResultsTable}>
              <thead>
                <tr>
                  <Each
                    table="meta"
                    recordName="column"
                    where={sql`column.name in (select name from meta_with_columns where enabled)`}
                  >
                    <th sx={styles.queryResultsTableHeader}>
                      {sql`column.name`}
                    </th>
                  </Each>
                </tr>
              </thead>
              <tbody>
                <Each table="dyn_result" recordName="record">
                  <tr
                    sx={{
                      "&:hover": {
                        backgroundColor: "primary-50",
                        dark: {
                          backgroundColor: "primary-800",
                        },
                      },
                    }}
                  >
                    <Each
                      table="meta"
                      recordName="column"
                      where={sql`column.name in (select name from meta_with_columns where enabled)`}
                    >
                      <td
                        sx={{
                          padding: 1,
                          whiteSpace: "nowrap",
                          width: "auto",
                          maxWidth: "none",
                          overflow: "visible",
                          textOverflow: "clip",
                          cursor: "pointer",
                          "&:hover": {
                            backgroundColor: "primary-50",
                            dark: {
                              backgroundColor: "primary-800",
                            },
                          },
                        }}
                        onClick={(s) => {
                          s.setScalar("copied", true);
                          s.setScalar(
                            "copy_message",
                            sql.lit`Copied field value to clipboard`,
                          );
                          s.clipboard.writeText(
                            sql`dynamic_field(record, column.index)`,
                          );
                        }}
                      >
                        {sql`dynamic_field(record, column.index)`}
                      </td>
                    </Each>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Show>
        </Show>
      </div>
    </Data>
  );
}

interface FieldDisplayOpts {
  name: string;
  notNull: boolean;
  type?: string;
  expr?: string;
}

function DisplayField({ name, notNull, type, expr }: FieldDisplayOpts) {
  return (
    <div sx={styles.schemaField}>
      <div>
        {notNull
          ? (
            <div sx={styles.notNullFieldName}>
              <span sx={styles.fieldName}>{name}</span>
              {notNull && (
                <Chip color="neutral" variant="soft" size="sm">
                  not null
                </Chip>
              )}
            </div>
          )
          : <span sx={styles.fieldName}>{name}</span>}
        {type && <span sx={styles.fieldType}>{type}</span>}
        {expr && <div sx={styles.virtualFieldExpr}>{expr}</div>}
      </div>
    </div>
  );
}

function TransactionQueryReference() {
  return (
    <>
      <Typography level="h4" sx={styles.sectionHeader}>
        Transaction Queries
      </Typography>
      <Divider />
      <CollapseControl label={sql.lit`tx`}>
        <div sx={styles.tableFields}>
          <DisplayField name="id" type="biguint" notNull />
          <DisplayField name="timestamp" type="timestamp" notNull />
          <DisplayField name="creator" type="sys_users (fk)" notNull={false} />
        </div>
      </CollapseControl>
      <CollapseControl label={sql.lit`tx_op`}>
        <div sx={styles.tableFields}>
          <Typography sx={styles.txInfoText}>
            This "table" gives you access to every record operation every
            performed in the database. It can have very many records and it has
            many fields.
          </Typography>
          <DisplayField name="tx_id" type="biguint" notNull />
          <DisplayField name="tx_timestamp" type="timestamp" notNull />
          <DisplayField
            name="tx_creator"
            type="sys_users (fk)"
            notNull={false}
          />
          <DisplayField name="kind" type="sys_op_kind (enum)" notNull />
          <DisplayField
            name="table"
            type="sys_db_table (enum)"
            notNull
          />
          <DisplayField name="skip_count" type="biguint" notNull={false} />
          <DisplayField name="sequence_id" type="biguint" notNull />
          <DisplayField name="record_id" type="biguint" notNull />
          <DisplayField name="tx_log_position" type="biguint" notNull />
          <Typography sx={styles.txInfoText}>
            If the content of a field in provided in the record operation
            (insert, update), you can access it using the following field:
          </Typography>
          <DisplayField
            name="{table}__{field}"
            type="field's type"
            notNull={false}
          />
          <Typography sx={styles.txInfoText}>
            In an update operation, you can use the following to see if the
            field was set in the record operation
          </Typography>
          <DisplayField
            name="{table}__{field}__set"
            type="bool"
            notNull={false}
          />
          <Typography sx={styles.txInfoText}>
            The following query gets what the first name of the contact with id
            0 was updated to, in only the first update operation:
          </Typography>
          <Typography sx={styles.txInfoCode}>
            select contact__first_name from tx_op where table = 'contact' and
            kind = 'update' and contact__first_name__set and record_id = 0 order
            by tx_id limit 1
          </Typography>
        </div>
      </CollapseControl>
      <CollapseControl label={sql.lit`{table}__versions`}>
        <div sx={styles.tableFields}>
          <Typography sx={styles.txInfoText}>
            Each table has a companion view that returns one row per operation
            on that table, with the field values at that operation. Easiest way
            to read per-record history. For example:
          </Typography>
          <Typography sx={styles.txInfoCode}>
            select tx_id, op_kind, contact__first_name from contact__versions
            where record_id = 0 order by tx_id
          </Typography>
          <Typography sx={styles.txInfoText}>
            Each field is exposed as `{`{table}__{field}`}` (its value at that
            op) and `{`{table}__{field}__set`}` (true if written by that op).
          </Typography>
        </div>
      </CollapseControl>
      <CollapseControl label={sql.lit`sys_op_kind`}>
        <div sx={styles.enumValues}>
          <div sx={styles.enumValue}>insert</div>
          <div sx={styles.enumValue}>update</div>
          <div sx={styles.enumValue}>delete</div>
          <div sx={styles.enumValue}>skip</div>
          <div sx={styles.enumValue}>restore</div>
        </div>
      </CollapseControl>
      <CollapseControl label={sql.lit`sys_db_table`}>
        <div sx={styles.enumValues}>
          <Each
            table="schema_tables"
            recordName="tx_schema_table"
            orderBy={sql`tx_schema_table.name`}
          >
            <div sx={styles.enumValue}>{sql`tx_schema_table.name`}</div>
          </Each>
        </div>
      </CollapseControl>
    </>
  );
}

function SchemaReference() {
  const tables = Object.values(system.db.tables);
  tables.sort((a, b) => a.name.localeCompare(b.name));

  const tableRows = tables.map((table) => {
    const foreignKeys = Object.values(table.fields)
      .filter((field) => field.type === "ForeignKey")
      .map((field) => field.table)
      .join(", ");
    return valuesRow(
      sql.lit(table.name),
      sql`(select count(*) from ${table.ident})`,
      foreignKeys ? sql.lit(foreignKeys) : sql.null,
    );
  });
  const fieldRows = tables.flatMap((table) => {
    const rows = Object.values(table.fields).map((field, index) => {
      let typeString = field.type.toLowerCase();
      if (field.type === "ForeignKey") {
        typeString = `${field.table} (fk)`;
      } else if (field.type === "Enum") {
        typeString = `${field.enum} (enum)`;
      } else if (field.type === "Tx") {
        typeString = "tx (biguint)";
      }
      return valuesRow(
        sql.lit(table.name),
        sql.lit(field.name),
        sql.lit(typeString),
        field.notNull ?? false,
        sql.lit`field`,
        sql.null,
        index + (system.db.enableTransactionQueries ? 2 : 0),
      );
    });
    if (system.db.enableTransactionQueries) {
      rows.unshift(
        valuesRow(
          sql.lit(table.name),
          sql.lit`created_by_tx`,
          sql.lit`tx (biguint)`,
          true,
          sql.lit`field`,
          sql.null,
          0,
        ),
        valuesRow(
          sql.lit(table.name),
          sql.lit`last_modified_by_tx`,
          sql.lit`tx (biguint)`,
          true,
          sql.lit`field`,
          sql.null,
          1,
        ),
      );
    }
    rows.push(
      ...Object.entries(table.virtuals).map(([name, virtual], index) => {
        let typeString = virtual.type?.type?.toLowerCase();
        if (virtual.type?.type === "Enum") {
          typeString = `${virtual.type.enum} (enum)`;
        }
        return valuesRow(
          sql.lit(table.name),
          sql.lit(name),
          typeString ? sql.lit(typeString) : sql.null,
          false,
          sql.lit`virtual`,
          sql.lit(virtual.expr.toSQL()),
          index,
        );
      }),
    );
    return rows;
  });

  // Get views if they exist
  const views = Object.entries(system.db.views || {});
  views.sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <Data
      procedure={(s) => {
        s.defScalar("table_search", sql.lit``);
        s.defScalar("hide_empty_tables", false);
        s.defTable("schema_tables", {
          fields: [
            {
              name: "name",
              type: { type: "String", maxLength: 1000 },
              notNull: true,
            },
            { name: "row_count", type: "BigUint", notNull: true },
            {
              name: "foreign_keys",
              type: { type: "String", maxLength: 100000 },
            },
          ],
        });
        s.modify(
          sql`insert into schema_tables (name, row_count, foreign_keys) values ${tableRows}`,
        );
        s.defTable("schema_fields", {
          fields: [
            {
              name: "table_name",
              type: { type: "String", maxLength: 1000 },
              notNull: true,
            },
            {
              name: "name",
              type: { type: "String", maxLength: 1000 },
              notNull: true,
            },
            {
              name: "type_label",
              type: { type: "String", maxLength: 1000 },
            },
            { name: "not_null", type: "Bool", notNull: true },
            {
              name: "kind",
              type: { type: "String", maxLength: 20 },
              notNull: true,
            },
            {
              name: "expr",
              type: { type: "String", maxLength: 1000000 },
            },
            { name: "ordering", type: "BigUint", notNull: true },
          ],
        });
        s.modify(
          sql`insert into schema_fields (table_name, name, type_label, not_null, kind, expr, ordering) values ${fieldRows}`,
        );
      }}
    >
      <div sx={styles.schemaWrapper}>
        <div sx={styles.schema}>
          <Typography level="h4">Tables</Typography>
          <Input
            placeholder="Search tables, views and enums…"
            startIcon="Search"
            bindScalar="table_search"
            className="mb-2"
            color="neutral"
          />
          <SwitchControl
            sx={{ alignSelf: "flex-start" }}
            checked={sql`hide_empty_tables`}
            onCheckboxChange={(s) =>
              s.setScalar("hide_empty_tables", sql`target_checked`)}
            endDecorator="Hide empty tables"
          />
          <Divider className="mb-4 mt-2" />
          <Each
            table="schema_tables"
            recordName="schema_table"
            where={sql`(not hide_empty_tables or schema_table.row_count > 0) and (table_search = '' or lower(schema_table.name) like '%' || lower(table_search) || '%')`}
            orderBy={sql`schema_table.name`}
            eachKey={sql`schema_table.name`}
          >
            <Card sx={styles.tableCard}>
              <div sx={styles.tableNameDisplay}>
                <div sx={styles.tableNameAndActions}>
                  <Typography
                    level="title-sm"
                    sx={{ ...styles.tableName }}
                    startIcon="TableChartOutlined"
                    onClick={(s) => {
                      s.clipboard.writeText(sql`schema_table.name`);
                      s.setScalar("copied", true);
                      s.setScalar(
                        "copy_message",
                        sql.lit`Copied table name to clipboard`,
                      );
                    }}
                  >
                    {sql`schema_table.name`}
                  </Typography>
                  <Menu>
                    <Menu.IconButton
                      icon="MoreVert"
                      aria-label="Actions"
                      size="sm"
                      variant="plain"
                      sx={styles.menuIconButton}
                    />
                    <Menu.Content>
                      <Menu.Item
                        onClick={(s) => {
                          s.setScalar(
                            "query",
                            sql`'select * from ' || schema_table.name`,
                          );
                          s.setScalar("selected_tab", sql.lit`query`);
                          queueQueryRun(s, sql`query`);
                          s.modify(
                            sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
                          );
                        }}
                      >
                        See all
                      </Menu.Item>
                      <Menu.Item
                        onClick={(s) => {
                          s.setScalar(
                            "query",
                            sql`'select * from ' || schema_table.name || ' limit 100'`,
                          );
                          s.setScalar("selected_tab", sql.lit`query`);
                          queueQueryRun(s, sql`query`);
                          s.modify(
                            sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
                          );
                        }}
                      >
                        See top 100
                      </Menu.Item>
                    </Menu.Content>
                  </Menu>
                </div>

                <div className="text-sm text-neutral-500">
                  {sql`format.decimal(schema_table.row_count) || case when schema_table.row_count = 1 then ' row' else ' rows' end`}
                </div>
              </div>

              <CollapseControl label={sql.lit`Show Fields`}>
                <div sx={styles.tableFields}>
                  <Each
                    table="schema_fields"
                    recordName="schema_field"
                    where={sql`schema_field.table_name = schema_table.name and schema_field.kind = 'field'`}
                    orderBy={sql`schema_field.ordering`}
                    eachKey={sql`schema_field.name`}
                  >
                    <Typography
                      component="div"
                      level="body-sm"
                      sx={styles.fieldCopy}
                      onClick={(s) => {
                        s.clipboard.writeText(sql`schema_field.name`);
                        s.setScalar("copied", true);
                        s.setScalar(
                          "copy_message",
                          sql.lit`Copied field name to clipboard`,
                        );
                      }}
                    >
                      <div sx={styles.schemaField}>
                        <div>
                          <Show
                            when={sql`schema_field.not_null`}
                            fallback={
                              <span sx={styles.fieldName}>
                                {sql`schema_field.name`}
                              </span>
                            }
                          >
                            <div sx={styles.notNullFieldName}>
                              <span sx={styles.fieldName}>
                                {sql`schema_field.name`}
                              </span>
                              <Chip color="neutral" variant="soft" size="sm">
                                not null
                              </Chip>
                            </div>
                          </Show>
                          <Show when={sql`schema_field.type_label is not null`}>
                            <span sx={styles.fieldType}>
                              {sql`schema_field.type_label`}
                            </span>
                          </Show>
                        </div>
                      </div>
                    </Typography>
                  </Each>
                </div>
              </CollapseControl>

              <Show
                when={sql`exists (select 1 from schema_fields where table_name = schema_table.name and kind = 'virtual')`}
              >
                <CollapseControl label={sql.lit`Show Virtual Fields`}>
                  <div sx={styles.virtualFields}>
                    <Each
                      table="schema_fields"
                      recordName="schema_virtual_field"
                      where={sql`schema_virtual_field.table_name = schema_table.name and schema_virtual_field.kind = 'virtual'`}
                      orderBy={sql`schema_virtual_field.ordering`}
                      eachKey={sql`schema_virtual_field.name`}
                    >
                      <Typography
                        component="div"
                        level="body-sm"
                        sx={styles.virtualFieldCopy}
                        onClick={(s) => {
                          s.clipboard.writeText(sql`schema_virtual_field.name`);
                          s.setScalar("copied", true);
                          s.setScalar(
                            "copy_message",
                            sql.lit`Copied virtual field name to clipboard`,
                          );
                        }}
                      >
                        <div sx={styles.schemaField}>
                          <div>
                            <span sx={styles.fieldName}>
                              {sql`schema_virtual_field.name`}
                            </span>
                            <Show
                              when={sql`schema_virtual_field.type_label is not null`}
                            >
                              <span sx={styles.fieldType}>
                                {sql`schema_virtual_field.type_label`}
                              </span>
                            </Show>
                            <Show
                              when={sql`schema_virtual_field.expr is not null`}
                            >
                              <div sx={styles.virtualFieldExpr}>
                                {sql`schema_virtual_field.expr`}
                              </div>
                            </Show>
                          </div>
                        </div>
                      </Typography>
                    </Each>
                  </div>
                </CollapseControl>
              </Show>

              <Show when={sql`schema_table.foreign_keys is not null`}>
                <div sx={styles.foreignKeys}>
                  <Typography sx={styles.fkTable} startIcon="CompareArrows">
                    {sql`schema_table.foreign_keys`}
                  </Typography>
                </div>
              </Show>
            </Card>
          </Each>

          {/* Display Views Section */}
          {views.length > 0 && (
            <>
              <Typography level="h4" sx={styles.sectionHeader}>
                Views
              </Typography>
              <Divider />
              {views.map(([viewName, viewDef]) => (
                <Show
                  when={sql`table_search = '' or lower(${
                    sql.lit(viewName)
                  }) like '%' || lower(table_search) || '%'`}
                >
                  <Card sx={styles.viewCard}>
                    <div sx={styles.tableNameDisplay}>
                      <div sx={styles.tableNameAndActions}>
                        <Typography
                          level="title-sm"
                          sx={{ ...styles.viewName }}
                          startIcon="ViewCozy"
                          onClick={(s) => {
                            s.clipboard.writeText(sql.lit(viewName));
                            s.setScalar("copied", true);
                            s.setScalar(
                              "copy_message",
                              sql.lit`Copied view name to clipboard`,
                            );
                          }}
                        >
                          {viewName}
                        </Typography>
                        <Menu>
                          <Menu.IconButton
                            icon="MoreVert"
                            aria-label="Actions"
                            size="sm"
                            variant="plain"
                            sx={styles.menuIconButton}
                          />
                          <Menu.Content>
                            <Menu.Item
                              onClick={(s) => {
                                s.setScalar(
                                  "query",
                                  sql.lit`select * from ${viewName}`,
                                );
                                s.setScalar("selected_tab", sql.lit`query`);
                                queueQueryRun(s, sql`query`);
                                s.modify(
                                  sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
                                );
                              }}
                            >
                              Query view
                            </Menu.Item>
                            <Menu.Item
                              onClick={(s) => {
                                s.setScalar(
                                  "query",
                                  sql.lit`select * from ${viewName} limit 100`,
                                );
                                s.setScalar("selected_tab", sql.lit`query`);
                                queueQueryRun(s, sql`query`);
                                s.modify(
                                  sql`insert into query_history (query, timestamp) values (ui.query, current_timestamp)`,
                                );
                              }}
                            >
                              Query view (limit 100)
                            </Menu.Item>
                          </Menu.Content>
                        </Menu>
                      </div>
                    </div>

                    <CollapseControl
                      label={sql.lit`Show View Definition`}
                      type="view"
                    >
                      <div sx={styles.viewFields}>
                        <Typography
                          sx={{
                            fontSize: "sm",
                            p: 1,
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {viewDef.query.toSQL()}
                        </Typography>
                      </div>
                    </CollapseControl>
                  </Card>
                </Show>
              ))}
            </>
          )}

          <Typography level="h4" sx={styles.sectionHeader}>
            Enums
          </Typography>
          <Divider />
          {Object.values(system.enums).length !== 0 &&
            Object.values(system.enums)
              .toSorted((a, b) => a.name.localeCompare(b.name))
              .filter((enum_) =>
                Object.values(system.db.tables).some((t) =>
                  Object.values(t.fields).some(
                    (f) => f.type === "Enum" && f.enum === enum_.name,
                  )
                )
              )
              .map((enum_) => (
                <Show
                  when={sql`table_search = '' or lower(${
                    sql.lit(enum_.name)
                  }) like '%' || lower(table_search) || '%'`}
                >
                  <CollapseControl label={sql.lit(enum_.name)}>
                    <div sx={styles.enumValues}>
                      {Object.values(enum_.values).map((v) => (
                        <div sx={styles.enumValue}>{sql.lit(v.name)}</div>
                      ))}
                    </div>
                  </CollapseControl>
                </Show>
              ))}

          {system.db.enableTransactionQueries && <TransactionQueryReference />}
        </div>
      </div>
    </Data>
  );
}

/** Props for {@link DbManagementPage} (and the inner {@link DbManagement}). */
export interface DbManagementPageProps {
  /** Route path. Defaults to `/db-management`. */
  path?: string;
  /** Optional authorization expression; the page is only mounted when it is true. */
  allow?: BooleanExpr;
  /** Number of columns rendered in the query result table. */
  queryColumnCount?: number;
  /**
   * Wraps the route content (inside the `<Route>`). Useful for adding
   * authorization or layout wrappers while keeping the page self-routing.
   */
  wrapper?: (children: Node) => Node;
}

/**
 * Inner component for {@link DbManagementPage}. Renders the query
 * editor, schema browser, and result viewer without the surrounding
 * `<Route>`. Use this when embedding the management UI inside an
 * existing route; most callers use `DbManagementPage` instead.
 */
export function DbManagement({ allow }: DbManagementPageProps) {
  const content = (
    <Data
      local
      procedure={(s) => {
        s.defScalar("selected_tab", sql.lit`query`);
        s.defScalar("query", sql.lit``);
        s.defScalar("query_include_explain", false);
        s.defScalar("query_explain_only", false);
        s.defScalar("query_collect_metrics", false);
        s.defScalar("query_skip_auto_row_cap", false);
        s.defScalar("query_run_key", 0);
        s.defScalar("query_to_run", {
          type: { type: "String", maxLength: 1000000 },
        });
        s.defTable("query_history", {
          fields: [
            { name: "query", type: "String" },
            { name: "timestamp", type: "TimestampTz" },
          ],
        });
        s.defScalar("copied", false);
        s.defScalar("copy_message", sql.lit``);
      }}
    >
      <div sx={styles.root}>
        <SchemaReference />
        <Show when={sql`copied`}>
          <Snackbar
            color="success"
            anchorOrigin={{
              vertical: "bottom",
              horizontal: "center",
            }}
            startDecorator={<MaterialIcon icon="CheckCircle" />}
            onMount={(s) => {
              s.sleep(5000);
              s.setScalar("copied", false);
            }}
          >
            {sql`copy_message`}
          </Snackbar>
        </Show>
        <Tabs
          value={sql`selected_tab`}
          onValueChange={(s, value) => s.setScalar("selected_tab", value)}
          sx={styles.tabs}
        >
          <Tabs.List>
            <Tabs.Tab value="query" selectedColor="primary">
              Query
            </Tabs.Tab>
            <Tabs.Tab value="modify" selectedColor="primary">
              Modify
            </Tabs.Tab>
            <Tabs.Tab value="undo" selectedColor="primary">
              Undo Transaction
            </Tabs.Tab>
            <Tabs.Tab value="history" selectedColor="primary">
              Query History
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="query">
            <QueryTab />
          </Tabs.Panel>
          <Tabs.Panel value="modify">
            <ModifyTab />
          </Tabs.Panel>
          <Tabs.Panel value="undo">
            <UndoTxTab />
          </Tabs.Panel>
          <Tabs.Panel value="history">
            <QueryHistoryTab />
          </Tabs.Panel>
        </Tabs>
      </div>
    </Data>
  );

  if (allow) {
    return (
      <Data procedure={(_s) => {}} statusScalar="status">
        <Show
          when={sql`status = 'fallback_triggered'`}
          fallback={
            <Show
              when={sql`status = 'failed'`}
              fallback={
                <Show when={sql`status = 'disallowed'`} fallback={content}>
                  <Alert color="danger">
                    You are not authorized to view this page.
                  </Alert>
                </Show>
              }
            >
              <Alert color="danger">Unable to load page.</Alert>
            </Show>
          }
        >
          <CircularProgress size="lg" />
        </Show>
      </Data>
    );
  }

  return content;
}

/**
Component that provides a page for database management tasks, including SQL queries and undo of transactions.

@category Page Component

 */
export function DbManagementPage(props: DbManagementPageProps = {}) {
  const content = <DbManagement {...props} />;
  const wrapped = props.wrapper ? props.wrapper(content) : content;
  return (
    <Route path={props.path ?? "/db-management"} title="Database Management">
      {wrapped}
    </Route>
  );
}
