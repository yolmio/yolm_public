import { Alert } from "components/alert";
import { Data } from "std/data";
import { sql } from "../../std/sql_utils";
import type { NumericExpr } from "../../std/sql_utils";
import { Match, Switch } from "std/ui";
import { BasicEmailEditorLexical } from "./lexical_basic_editor";
import { AdvancedEmailEditorLexical } from "./lexical_advanced_editor";

interface EmailEditorProps {
  recordId: NumericExpr;
}

export function EmailEditor({ recordId }: EmailEditorProps) {
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "email_template_type",
          sql`(select type from db.email_templates where id = ${recordId})`,
        );
      }}
    >
      <Switch>
        <Match when={sql`email_template_type = 'basic'`}>
          <BasicEmailEditorLexical recordId={recordId} />
        </Match>
        <Match when={sql`email_template_type = 'advanced'`}>
          <AdvancedEmailEditorLexical recordId={recordId} />
        </Match>
        <Match when={sql`email_template_type is null`}>
          <Alert color="danger">Email template not found</Alert>
        </Match>
      </Switch>
    </Data>
  );
}
