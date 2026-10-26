import { type AnyExpr, sql } from "std/sql_utils";
import type { IServerBaseStatements } from "std/statements";
import { system } from "std/system";

/** Check inside the writer's transaction, including after restoring an edit. */
export function assertEmailTemplateEditable<T extends IServerBaseStatements>(
  s: T,
  templateId: AnyExpr,
) {
  if (!system.db.tables.marketing_email_campaigns) return;
  s.throwErrorIf(
    sql`exists(select 1 from db.marketing_email_campaigns
      where email_template_id = ${templateId} and status in ('scheduled', 'submitting'))`,
    sql
      .lit`This template is in use by a scheduled campaign. Cancel it or create a separate template.`,
  );
}
