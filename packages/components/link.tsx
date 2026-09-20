import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";

const styles: StyleObject = {
  color: "primary-500",
  textDecoration: "none",
  "&:hover": { textDecoration: "underline" },
  textDecorationColor: "primary-400",
};

/**
Just wraps the <a> tag, but has nicer styling integrated with the theme.

@category Routing Component
 */
export function Link(props: JSX.IntrinsicElements["a"]) {
  return <a {...props} sx={props.sx ? [styles, props.sx] : styles} />;
}

/**
 Turns a stored URL value into an href, prefixing `https://` when the value
 has no scheme (e.g. `www.example.com`).

 @category Routing Component
 */
export function externalUrlHref(value: Sql): Sql {
  return sql`
    case
      when ${value} is null or trim(${value}) = '' then ${value}
      when starts_with(lower(${value}), 'http://')
        or starts_with(lower(${value}), 'https://')
        then ${value}
      else 'https://' || ${value}
    end
  `;
}
