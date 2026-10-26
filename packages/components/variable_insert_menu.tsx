import { Menu } from "components/menu";
import type { IconName } from "components/material_icon_names";
import type { DomStatements } from "std/statements";
import type { Variant } from "std/theme";

/** A displayed template variable and its exact insertion text. */
export interface TemplateVariable {
  key: string;
  description: string;
  token: string;
}

/** Tokens and the editor action used by the insertion menu. */
export interface VariableInsertMenuProps {
  variables: readonly TemplateVariable[];
  onInsert: (s: DomStatements, variable: TemplateVariable) => void;
  variant?: Variant;
  icon?: IconName;
}

/** Inserts caller-defined tokens without depending on a block or editor. */
export function VariableInsertMenu(props: VariableInsertMenuProps) {
  return (
    <Menu>
      <Menu.IconButton
        variant={props.variant ?? "outlined"}
        color="neutral"
        size="sm"
        icon={props.icon ?? "Code"}
        aria-label="Insert variable"
      />
      <Menu.Content className="max-h-[200px] overflow-auto">
        {props.variables.map((variable) => (
          <Menu.Item onClick={(s) => props.onInsert(s, variable)}>
            {`${variable.token} - ${variable.description || variable.key}`}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
}
