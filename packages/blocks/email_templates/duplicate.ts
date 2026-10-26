import { sql } from "std/sql_utils";
import { system } from "std/system";

/** Copy the editable tree atomically; immutable image blobs remain shared. */
export function registerDuplicateEmailTemplate() {
  system.storedProcedure({
    name: "email_template_duplicate",
    transaction: "caller",
    inputScalars: [{ name: "p_template_id", type: "BigInt" }],
    outputScalars: [{ name: "o_template_id", type: "BigInt" }],
    procedure: (s) => {
      s.throwErrorUnless(
        sql`exists(select 1 from email_templates where id = p_template_id)`,
        sql
          .lit`This template no longer exists. Refresh the list and try again.`,
      );
      s.modify(sql`insert into email_templates
        (name, subject, preview_text, background_color, type, is_active, body)
        select substring(name from 1 for 193) || ' (copy)', subject, preview_text,
          background_color, type, is_active, body
        from email_templates where id = p_template_id
        returning id into o_template_id`);
      const sectionFields = Object.keys(system.db.tables.email_sections.fields)
        .filter((name) => name !== "id" && name !== "email_template_id")
        .map((name) => sql.ref(name));
      const columnFields = Object.keys(system.db.tables.email_columns.fields)
        .filter((name) => name !== "id" && name !== "email_section_id")
        .map((name) => sql.ref(name));
      const blockFields = Object.keys(system.db.tables.email_blocks.fields)
        .filter((name) => name !== "id" && name !== "email_column_id")
        .map((name) => sql.ref(name));
      s.forEachQuery(
        sql`select id from email_sections where email_template_id = p_template_id order by "order", id`,
        "source_section",
        (s) => {
          s.defScalar("new_section_id", { type: "BigInt" });
          s.modify(
            sql`insert into email_sections (email_template_id, ${sectionFields})
            select o_template_id, ${sectionFields} from email_sections where id = source_section.id
            returning id into new_section_id`,
          );
          s.forEachQuery(
            sql`select id from email_columns where email_section_id = source_section.id order by "order", id`,
            "source_column",
            (s) => {
              s.defScalar("new_column_id", { type: "BigInt" });
              s.modify(
                sql`insert into email_columns (email_section_id, ${columnFields})
                select new_section_id, ${columnFields} from email_columns where id = source_column.id
                returning id into new_column_id`,
              );
              s.modify(
                sql`insert into email_blocks (email_column_id, ${blockFields})
                select new_column_id, ${blockFields} from email_blocks where email_column_id = source_column.id`,
              );
            },
          );
        },
      );
    },
  });
}
