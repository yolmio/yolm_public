import { AuthBlock } from "blocks/auth";
import { Checkbox } from "components/checkbox";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { Typography } from "components/typography";
import { type Sql, sql } from "std/sql_utils";
import type { ServerStatementsBase, StateStatements } from "std/statements";
import type { Node } from "std/ui";
import type { TrainingBlock } from "./index.tsx";
import { trainingPermissions } from "./helpers";

export function initializeTrainingDocumentDetailState(
  s: StateStatements,
  documentId: Sql,
) {
  s.defScalar(
    "training_settings_requires_essay",
    sql`coalesce((
      select requires_essay
      from db.training_document_settings
      where document_id = ${documentId}
    ), false)`,
  );
  s.defScalar(
    "training_settings_essay_prompt",
    sql`coalesce((
      select default_essay_prompt
      from db.training_document_settings
      where document_id = ${documentId}
    ), '')`,
  );
  s.defScalar(
    "training_settings_due_days",
    sql`coalesce((
      select due_within_days::string
      from db.training_document_settings
      where document_id = ${documentId}
    ), '7')`,
  );
  s.defScalar(
    "training_settings_reminder_days",
    sql`coalesce((
      select reminder_after_days::string
      from db.training_document_settings
      where document_id = ${documentId}
    ), '7')`,
  );
  s.defScalar(
    "training_settings_reminder_repeat",
    sql`coalesce((
      select reminder_repeat_every_days::string
      from db.training_document_settings
      where document_id = ${documentId}
    ), '7')`,
  );
  s.defScalar(
    "training_settings_overdue_days",
    sql`coalesce((
      select overdue_after_days::string
      from db.training_document_settings
      where document_id = ${documentId}
    ), '1')`,
  );
  s.defScalar(
    "training_settings_overdue_repeat",
    sql`coalesce((
      select overdue_repeat_every_days::string
      from db.training_document_settings
      where document_id = ${documentId}
    ), '7')`,
  );
}

export function saveTrainingDocumentDetailSettings(
  s: ServerStatementsBase<any>,
  block: TrainingBlock,
  documentId: Sql,
) {
  s.startTransaction();
  block.updateTrainingDocumentSettings(s, {
    documentId,
    requiresEssay: sql`ui.training_settings_requires_essay`,
    defaultEssayPrompt: sql`ui.training_settings_essay_prompt`,
    dueWithinDays: sql`ui.training_settings_due_days::bigint`,
    reminderAfterDays: sql`ui.training_settings_reminder_days::bigint`,
    reminderRepeatEveryDays:
      sql`nullif(ui.training_settings_reminder_repeat, '')::bigint`,
    overdueAfterDays: sql`ui.training_settings_overdue_days::bigint`,
    overdueRepeatEveryDays:
      sql`nullif(ui.training_settings_overdue_repeat, '')::bigint`,
  });
  s.commitTransaction();
}

/** Training-owned settings rendered inside Documents' shared Settings tab. */
export function TrainingDocumentSettingsPanel() {
  return (
    <AuthBlock.PermissionCheck
      permission={trainingPermissions.manageDocumentSettings}
    >
      <SettingsGroup title="Completion requirements">
        <div className="flex items-center justify-between gap-4 border-b border-neutral-100 py-3">
          <div className="min-w-0">
            <FormLabel>Requires overall essay</FormLabel>
            <Typography level="body-xs" className="text-neutral-500">
              Ask a written question before final signoff.
            </Typography>
          </div>
          <Checkbox
            checked={sql`training_settings_requires_essay`}
            onCheckboxChange={(s) =>
              s.setScalar(
                "training_settings_requires_essay",
                sql`target_checked`,
              )}
          />
        </div>
        <FormControl className="py-3">
          <FormLabel>Essay prompt</FormLabel>
          <Typography level="body-xs" className="mb-2 text-neutral-500">
            Shown just before signoff when essay completion is required.
          </Typography>
          <Input
            value={sql`training_settings_essay_prompt`}
            placeholder="Describe two hazards you would check before starting."
            onInput={(s) =>
              s.setScalar("training_settings_essay_prompt", sql`target_value`)}
          />
        </FormControl>
      </SettingsGroup>
      <SettingsGroup title="Assignment defaults">
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <NumberSetting
            label="Due after days"
            hint="Default deadline for direct assignments and ongoing rules."
            scalar="training_settings_due_days"
          />
          <NumberSetting
            label="Reminder after days"
            hint="First reminder timing for open assignments."
            scalar="training_settings_reminder_days"
          />
          <NumberSetting
            label="Repeat reminders every days"
            hint="Leave empty to send only once."
            scalar="training_settings_reminder_repeat"
            nullable
          />
          <NumberSetting
            label="Overdue notice after days"
            hint="Days after the due date before the first notice."
            scalar="training_settings_overdue_days"
          />
          <NumberSetting
            label="Repeat overdue notices every days"
            hint="Leave empty to send only once."
            scalar="training_settings_overdue_repeat"
            nullable
          />
        </div>
      </SettingsGroup>
    </AuthBlock.PermissionCheck>
  );
}

function SettingsGroup(props: { title: string; children: Node }) {
  return (
    <section className="rounded-lg border border-divider bg-white shadow-sm">
      <div className="px-5 pb-1 pt-4">
        <Typography
          level="body-xs"
          className="font-semibold uppercase tracking-wide text-neutral-500"
        >
          {props.title}
        </Typography>
      </div>
      <div className="px-5 pb-4">{props.children}</div>
    </section>
  );
}

function NumberSetting(props: {
  label: string;
  hint: string;
  scalar: string;
  nullable?: boolean;
}) {
  return (
    <FormControl className="border-b border-neutral-100 py-3 last:border-b-0">
      <FormLabel>{props.label}</FormLabel>
      <Typography level="body-xs" className="mb-2 text-neutral-500">
        {props.hint}
      </Typography>
      <Input
        type="number"
        min="0"
        value={sql.ref(props.scalar)}
        placeholder={props.nullable ? "No repeat" : undefined}
        onInput={(s) => s.setScalar(props.scalar, sql`target_value`)}
      />
    </FormControl>
  );
}
