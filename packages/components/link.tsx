import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { StyleObject } from "std/style_types";
import { backLinkAttrs } from "./utils";
import type { BackLinkOpts } from "./utils";

const styles: StyleObject = {
  color: "primary-500",
  textDecoration: "none",
  "&:hover": { textDecoration: "underline" },
  textDecorationColor: "primary-400",
};

/**
Just wraps the <a> tag, but has nicer styling integrated with the theme.

Set `backLink` on a link that returns to a parent or list page: it returns to
the most recent earlier history entry for `href`'s path, restoring that page's
filters and scroll, and is a plain link to `href` otherwise.

@category Routing Component
 */
export function Link(props: JSX.IntrinsicElements["a"] & BackLinkOpts) {
  const { backLink, ...rest } = props;
  return (
    <a
      {...rest}
      {...backLinkAttrs(props.href, backLink)}
      sx={props.sx ? [styles, props.sx] : styles}
    />
  );
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
