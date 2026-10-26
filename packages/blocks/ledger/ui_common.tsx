import { Alert } from "components/alert";
import { Input } from "components/input";
import { Typography } from "components/typography";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { UiServerStatements } from "std/statements";
import { system } from "std/system";
import { Show } from "std/ui";
import type { Node } from "std/ui";
import type { LedgerBlock } from "./index.tsx";

/** `payment_terms` → `Payment terms`. */
export function titleCase(key: string): string {
  const words = key.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A dimension's label, or its key in title case. */
export function dimensionLabel(d: { key: string; label?: string }): string {
  return d.label ?? titleCase(d.key);
}

export function date(expr: Sql): Sql {
  return sql`format.date(${expr}, '%m/%d/%Y')`;
}

/**
 * Display label of a record in any table: its `recordDisplayName` when
 * configured, otherwise its id.
 */
export function recordLabelSql(tableName: string, id: Sql): Sql {
  const table = system.db.tables[tableName];
  const label = table?.recordDisplayName
    ? table.getRecordDisplayNameExpr(sql`labeled_row`)
    : sql`cast(labeled_row.id as string)`;
  return sql`(select ${label} from db.${
    sql.ref(tableName)
  } labeled_row where labeled_row.id = ${id})`;
}

/** A server action for managers that runs `body` in one transaction. */
export function manageAction(
  block: LedgerBlock,
  body: (s: UiServerStatements) => void,
) {
  return (s: UiServerStatements) => {
    block.requireManage(s);
    s.startTransaction();
    body(s);
    s.commitTransaction();
  };
}

/**
 * A Void button with an optional date. Left empty, the reversal takes the
 * original date; a date (e.g. the first open day) voids something from a
 * closed month.
 */
export function VoidControl(
  props: {
    block: LedgerBlock;
    /** Unique prefix for the page's date scalar. */
    name: string;
    description: string;
    action: (s: UiServerStatements, date: Sql) => void;
  },
) {
  const scalar = `${props.name}_void_on`;
  return (
    <Data procedure={(s) => s.defScalar(scalar, { type: "Date" })}>
      <div className="flex items-center gap-2">
        <Input
          size="sm"
          type="date"
          aria-label="Void on"
          title="Void on this date; leave empty for the original date"
          value={sql.ref(scalar)}
          onInput={(s, value) =>
            s.setScalar(scalar, sql`try_cast(${value} as date)`)}
        />
        <ActionButton
          size="sm"
          color="danger"
          variant="outlined"
          confirm={{ description: props.description }}
          action={manageAction(
            props.block,
            (s) => props.action(s, sql.ref(scalar)),
          )}
          successMessage="Voided"
        >
          Void
        </ActionButton>
      </div>
    </Data>
  );
}

/**
 * Page shell. Defines `ledger_can_manage` for its children and replaces the
 * content when the viewer lacks the view permission.
 */
export function Page(
  props: {
    block: LedgerBlock;
    title: Node;
    /** Shown to every viewer, e.g. status chips and links. */
    aside?: Node;
    /** Shown only to users who may manage the books. */
    actions?: Node;
    children: Node;
  },
) {
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "ledger_can_view",
          props.block.canViewSql(sql`current_user`),
        );
        s.defScalar(
          "ledger_can_manage",
          props.block.canManageSql(sql`current_user`),
        );
      }}
    >
      <div className="flex flex-col gap-4 p-4 md:p-8 max-w-[1200px] mx-auto w-full">
        <Show
          when={sql`ledger_can_view`}
          fallback={
            <Alert color="warning">
              You do not have access to the books.
            </Alert>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Typography level="h2">{props.title}</Typography>
            <div className="flex flex-wrap items-center gap-2">
              {props.aside}
              <Show when={sql`ledger_can_manage`}>{props.actions}</Show>
            </div>
          </div>
          {props.children}
        </Show>
      </div>
    </Data>
  );
}
