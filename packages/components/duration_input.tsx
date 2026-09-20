import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { DomStatements } from "std/statements";
import { Input } from "./input";
import type { InputProps } from "./input";
import { singleElementComponent } from "./utils";

type DurationInputProps = Omit<InputProps, "onChange"> & {
  onChange: (s: DomStatements, value: Sql) => unknown;
};

/**
 A component for inputting duration values.

 @category UI Component

 @param props.onChange - Function to call when the input value changes.
 @param props.inputProps - Additional props to pass to the underlying Input component.

 @examples
 [Example](../pages/datagrid_internals/toolbar_filter.tsx)
 */
export function DurationInput(props: DurationInputProps) {
  // todo this doesn't work well with cmd+enter on forms, fix it
  const { onChange, ...inputProps } = props;
  const [RootSlot, rootProps] = singleElementComponent({
    component: Input,
    externalProps: inputProps,
    sx: {},
    internalProps: {
      placeholder: sql.lit`hh:mm`,
      // don't use inputMode="numeric" because it doesn't allow ":" on iOS
      onKeyDown: (s) => {
        s.if(
          sql`not event.ctrl_key and not event.meta_key and char_length(event.key) = 1 and event.key not in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ':')`,
          (s) => {
            s.event.preventDefault();
          },
        );
      },
      onChange: (s) => {
        onChange(
          s,
          sql`fn.display_minutes_duration(fn.parse_minutes_duration(target_value))`,
        );
      },
    },
  });
  return <RootSlot {...rootProps} />;
}
