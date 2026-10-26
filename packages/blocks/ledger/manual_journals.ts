import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import type { LedgerBlock, LedgerSource } from "./index.tsx";

/**
 * Manual journals are editable drafts. Posting validates and writes an
 * immutable entry; saving changes to a posted journal reverses the previous
 * entry and posts the new version, so the ledger keeps both.
 */
export function defineManualJournals(
  block: LedgerBlock,
  source: LedgerSource,
  reversalSource: LedgerSource,
) {
  const { db } = system;
  const unsignedAmount = { precision: 18, scale: 4, signed: false };

  db.table("ledger_manual_journals", (table) => {
    table.displayName("Manual journals");
    table.date("journal_date").notNull();
    table.string("description", 500).notNull();
    if (block.books.length) table.enum("book", "ledger_book");
    /** Posts the negated entry on this date too, e.g. for accruals. */
    table.date("reverse_on");
    /**
     * Makes the journal a recurring template: it never posts itself;
     * `runRecurringJournals` posts a copy on each due date through
     * `repeat_until`. `repeat_next` is the next due date; later ones fall
     * every `repeat_months` months from `journal_date` (month-end stays
     * month-end). A template's `reverse_on` reverses each occurrence the
     * same number of days after it.
     */
    table.smallInt("repeat_months").check(
      (months) => sql`${months} is null or ${months} between 1 and 24`,
      () => sql.lit`Repeat every 1 to 24 months`,
    );
    table.date("repeat_next");
    table.date("repeat_until");
    /** Why the last scheduled run could not post this template. */
    table.string("repeat_error", 500);
    table.check({
      fields: ["journal_date", "reverse_on"],
      errorMessage: () =>
        sql.lit`The reversal date must be after the journal date`,
      check: ([date, reverseOn]) =>
        sql`${reverseOn} is null or ${reverseOn} > ${date}`,
    });
    table.check({
      fields: ["repeat_months", "repeat_next"],
      errorMessage: () =>
        sql.lit`A recurring journal needs the date of its next occurrence`,
      check: ([months, next]) => sql`${months} is null or ${next} is not null`,
    });
    table.recordDisplayName(
      ["journal_date", "description"],
      (date, description) =>
        sql`format.date(${date}, '%m/%d/%Y') || ' ' || ${description}`,
    );
    table.skipAutoApi();
  });

  db.table("ledger_manual_journal_lines", (table) => {
    table.displayName("Manual journal lines");
    table.fk("manual_journal_id", "ledger_manual_journals").notNull()
      .onDelete("Cascade");
    table.fk("account_id", "ledger_accounts").notNull().onDelete("Restrict");
    table.money("debit", unsignedAmount);
    table.money("credit", unsignedAmount);
    table.string("memo", 500);
    for (const dimension of block.dimensions) {
      table.fk(`${dimension.key}_id`, dimension.table).onDelete("Restrict");
    }
    table.check({
      fields: ["debit", "credit"],
      errorMessage: () => sql.lit`A journal line is either a debit or a credit`,
      check: ([debit, credit]) =>
        sql`coalesce(${debit}, 0) = 0 or coalesce(${credit}, 0) = 0`,
    });
    table.skipAutoApi();
  });

  const dimensionColumns = block.dimensions.map((dimension) => dimension.key);
  system.storedProcedure({
    name: "ledger_post_manual_journal",
    transaction: "caller",
    inputScalars: [
      { name: "p_manual_journal_id", type: "BigInt" },
    ],
    outputScalars: [{ name: "entry_id", type: "BigInt" }],
    procedure: (s) => {
      s.defRecord(
        "journal",
        sql`select id, journal_date, description, reverse_on, repeat_months
            ${block.books.length ? sql`, book` : sql``}
          from db.ledger_manual_journals where id = p_manual_journal_id`,
      );
      s.throwErrorIf(
        sql`journal.id is null`,
        sql.lit`Journal not found`,
      );
      s.throwErrorIf(
        sql`journal.repeat_months is not null`,
        sql.lit`Recurring templates post their occurrences, not themselves`,
      );
      s.defScalar("previous_entry_id", {
        type: "BigInt",
        expr: source.activeEntryId(sql`p_manual_journal_id`),
      });
      s.throwErrorIf(
        sql`previous_entry_id is null and exists (select 1
          from db.ledger_entries
          where source = ${source.enumLiteral()}
            and source_record_id = p_manual_journal_id)`,
        sql.lit`A voided journal cannot be posted again`,
      );
      const dimensionList = dimensionColumns.length
        ? sql`, ${dimensionColumns.map((key) => sql.ref(`${key}_id`))}`
        : sql``;
      // Saving without changes keeps the current posting: same header and
      // the same multiset of lines, compared as posting would store them
      // (rounded per entity, unassigned entity as the home entity).
      const signedAmount = sql`round(
        coalesce(journal_line.debit, 0) - coalesce(journal_line.credit, 0),
        ${block.amountDecimalsSql(sql`journal_line`)})`;
      const compared = (line: string) =>
        dimensionColumns.length
          ? sql`, ${
            dimensionColumns.map((key) =>
              key === "entity"
                ? sql`${block.lineEntitySql(sql.ref(line))} as entity_id`
                : sql`${sql.ref(line)}.${sql.ref(`${key}_id`)}`
            )
          }`
          : sql``;
      s.defScalar(
        "journal_unchanged",
        sql`previous_entry_id is not null
          and (select posting_date = journal.journal_date
              and description = journal.description
              ${
          block.books.length
            ? sql`and coalesce(cast(book as string), '')
                = coalesce(cast(journal.book as string), '')`
            : sql``
        }
            from db.ledger_entries where id = previous_entry_id)
          and not exists (
            select 1 from (
              select journal_line.account_id, ${signedAmount} as amount,
                journal_line.memo ${compared("journal_line")}, 1 as side
              from db.ledger_manual_journal_lines journal_line
              where journal_line.manual_journal_id = p_manual_journal_id
                and ${signedAmount} <> 0
              union all
              select posted.account_id, posted.amount, posted.memo
                ${compared("posted")}, -1
              from db.ledger_lines posted
              where posted.entry_id = previous_entry_id
            ) both_versions
            group by account_id, amount, memo ${dimensionList}
            having sum(side) <> 0)`,
      );
      s.if(
        sql`journal_unchanged`,
        (s) => s.setScalar("entry_id", sql`previous_entry_id`),
        (s) => {
          s.if(sql`previous_entry_id is not null`, (s) => {
            block.reverseEntry(s, {
              entryId: sql`previous_entry_id`,
              description: sql`'Edited: ' || journal.description`,
            });
          });
          source.post(s, {
            recordId: sql`p_manual_journal_id`,
            date: sql`journal.journal_date`,
            description: sql`journal.description`,
            book: block.books.length ? sql`journal.book` : undefined,
            lines: {
              query: sql`select account_id,
                  coalesce(debit, 0) - coalesce(credit, 0) as amount, memo
                  ${dimensionList}
                from db.ledger_manual_journal_lines
                where manual_journal_id = p_manual_journal_id`,
              columns: ["memo", ...dimensionColumns],
            },
            intoEntryId: "entry_id",
          });
        },
      );
      // Keep the automatic reversal in step with the posted journal.
      s.defScalar("journal_entry_id", { type: "BigInt", expr: sql`entry_id` });
      s.defScalar("reversal_entry_id", {
        type: "BigInt",
        expr: reversalSource.activeEntryId(sql`p_manual_journal_id`),
      });
      s.if(
        sql`reversal_entry_id is not null and (not journal_unchanged
          or journal.reverse_on is null
          or journal.reverse_on <> (select posting_date
            from db.ledger_entries where id = reversal_entry_id))`,
        (s) => {
          block.reverseEntry(s, { entryId: sql`reversal_entry_id` });
          s.setScalar("reversal_entry_id", sql`null`);
        },
      );
      s.if(
        sql`journal.reverse_on is not null and reversal_entry_id is null`,
        (s) => {
          reversalSource.post(s, {
            recordId: sql`p_manual_journal_id`,
            date: sql`journal.reverse_on`,
            description: sql`'Reversal of ' || journal.description`,
            book: block.books.length ? sql`journal.book` : undefined,
            lines: {
              query: sql`select account_id, -amount as amount, memo
                  ${dimensionList}
                from db.ledger_lines line
                where line.entry_id = journal_entry_id`,
              columns: ["memo", ...dimensionColumns],
            },
          });
        },
      );
    },
  });

  system.storedProcedure({
    name: "ledger_void_manual_journal",
    transaction: "caller",
    inputScalars: [
      { name: "p_manual_journal_id", type: "BigInt" },
      // Reverses on this date; null reverses on the journal's own dates.
      { name: "p_date", type: "Date" },
    ],
    procedure: (s) => {
      source.reverse(s, {
        recordId: sql`p_manual_journal_id`,
        date: sql`p_date`,
        description: sql.lit`Voided journal entry`,
      });
      // The automatic reversal is undone no earlier than it happened, so
      // the void never leaves its liability standing in between.
      s.if(reversalSource.isPosted(sql`p_manual_journal_id`), (s) => {
        reversalSource.reverse(s, {
          recordId: sql`p_manual_journal_id`,
          date: sql`case when p_date is null then null
            else greatest(p_date, (select reverse_on
              from db.ledger_manual_journals
              where id = p_manual_journal_id)) end`,
        });
      });
    },
  });

  // Posts every due occurrence of recurring templates through `p_through`.
  system.storedProcedure({
    name: "ledger_run_recurring_journals",
    transaction: "caller",
    inputScalars: [
      { name: "p_through", type: "Date" },
      // Limits the run to one template when set.
      { name: "p_manual_journal_id", type: "BigInt" },
    ],
    outputScalars: [{ name: "posted_count", type: "BigInt" }],
    procedure: (s) => {
      const templateDimensions = dimensionColumns.length
        ? sql`, ${dimensionColumns.map((key) => sql.ref(`${key}_id`))}`
        : sql``;
      s.setScalar("posted_count", sql`0`);
      s.forEachQuery(
        sql`select id, journal_date, reverse_on, repeat_months, repeat_next,
            repeat_until
          from db.ledger_manual_journals
          where ${dueTemplatesSql(sql`p_through`)}
            and (p_manual_journal_id is null or id = p_manual_journal_id)`,
        "template",
        (s) => {
          // Loop conditions use scalars; the template row advances below.
          s.defScalar("next_occurrence", {
            type: "Date",
            expr: sql`template.repeat_next`,
          });
          // A journal posted before it became a template would count twice.
          s.throwErrorIf(
            source.isPosted(sql`template.id`),
            sql
              .lit`This template also has its own posting; void it before it repeats`,
          );
          s.while(
            sql`next_occurrence <= p_through
              and (template.repeat_until is null
                or next_occurrence <= template.repeat_until)`,
            (s) => {
              s.defScalar("occurrence_id", { type: "BigInt" });
              s.modify(sql`insert into db.ledger_manual_journals
                (journal_date, description, reverse_on
                  ${block.books.length ? sql`, book` : sql``})
                select next_occurrence, description,
                  date.add(day, date.diff(day, template.journal_date,
                    template.reverse_on), next_occurrence)
                  ${block.books.length ? sql`, book` : sql``}
                from db.ledger_manual_journals where id = template.id
                returning id into occurrence_id`);
              s.modify(sql`insert into db.ledger_manual_journal_lines
                (manual_journal_id, account_id, debit, credit, memo
                  ${templateDimensions})
                select occurrence_id, account_id, debit, credit, memo
                  ${templateDimensions}
                from db.ledger_manual_journal_lines
                where manual_journal_id = template.id`);
              s.defScalar("occurrence_entry_id", { type: "BigInt" });
              s.callStoredProcedure("ledger_post_manual_journal", {
                inputScalars: { p_manual_journal_id: sql`occurrence_id` },
                outputScalars: { entry_id: "occurrence_entry_id" },
              });
              // The next due date after this one on the journal date's
              // schedule, so dates do not drift; a template dated on a
              // month's last day stays on month-ends.
              const months = sql`cast(template.repeat_months * (floor(
                cast(date.diff(month, template.journal_date, next_occurrence)
                  as decimal(18, 4)) / template.repeat_months) + 1) as int)`;
              const monthEnd = (date: Sql) =>
                sql`date.subtract(day, 1,
                  date.add(month, 1, date.start_of_month(${date})))`;
              s.setScalar(
                "next_occurrence",
                sql`case when template.journal_date
                    = ${monthEnd(sql`template.journal_date`)}
                  then ${
                  monthEnd(
                    sql`date.add(month, ${months},
                      date.start_of_month(template.journal_date))`,
                  )
                }
                  else date.add(month, ${months}, template.journal_date) end`,
              );
              s.modify(sql`update db.ledger_manual_journals
                set repeat_next = next_occurrence, repeat_error = null
                where id = template.id`);
              s.setScalar("posted_count", sql`posted_count + 1`);
            },
          );
        },
      );
    },
  });
}

/**
 * `recurring`, `draft`, `posted`, or `void` for a manual journal record
 * expression.
 */
export function manualJournalStatusSql(
  source: LedgerSource,
  journalId: Sql,
): Sql {
  return sql`case
    when (select repeat_months from db.ledger_manual_journals
      where id = ${journalId}) is not null then 'recurring'
    when ${source.isPosted(journalId)} then 'posted'
    when exists (select 1 from db.ledger_entries
      where source = ${source.enumLiteral()}
        and source_record_id = ${journalId}) then 'void'
    else 'draft' end`;
}

/** Recurring templates with an occurrence due on or before `through`. */
export function dueTemplatesSql(through: Sql): Sql {
  return sql`repeat_months is not null and repeat_next <= ${through}
    and (repeat_until is null or repeat_next <= repeat_until)`;
}
