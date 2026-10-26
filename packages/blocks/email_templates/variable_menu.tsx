import { VariableInsertMenu as TemplateVariableInsertMenu } from "components/variable_insert_menu";
import { useFieldHelper } from "std/form";
import { sql } from "std/sql_utils";
import type { DomStatements } from "std/statements";
import { useBlockOptional } from "std/system";
import { type Node, usePhase } from "std/ui";
import { EmailTemplatesBlock } from "./index";

export function VariableInsertMenu(props: {
  onClick: (s: DomStatements, key: string) => void;
  variableType?: "recipient" | "link";
}) {
  const block = useBlockOptional(EmailTemplatesBlock);
  const variables =
    (props.variableType === "link"
      ? block?.getLinkVariables()
      : block?.getRecipientVariables()) ?? {};
  return (
    <TemplateVariableInsertMenu
      variables={Object.entries(variables).map(([key, description]) => ({
        key,
        description,
        token: `{{${key}}}`,
      }))}
      onInsert={(s, variable) => props.onClick(s, variable.key)}
    />
  );
}

export function FormFieldWithVariables(props: { children: Node }) {
  if (usePhase() === "gather") return props.children;
  const field = useFieldHelper();
  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1">{props.children}</div>
      <VariableInsertMenu
        onClick={(s, key) => {
          s.if(sql`${field.value} = '' or ${field.value} is null`, (s) => {
            field.setValue(s, sql.lit(`{{${key}}}`));
          }).else((s) => {
            field.setValue(s, sql.concat(field.value, sql.lit(` {{${key}}}`)));
          });
        }}
      />
    </div>
  );
}
