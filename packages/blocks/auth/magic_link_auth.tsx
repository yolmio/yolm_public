import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";
import { Authorize, useQueryParams } from "std/ui";
import type { Node } from "std/ui";

interface MagicLinkAuthProps {
  getUserFromToken: (token: Sql) => Sql;
  children: Node;
}

/*
 A component that handles authentication using a magic link token.

 Magic link is a special url that can be sent to a user to log them in without a password.

 Generally not recommended for most applications.

 @category Authentication Component
 */
export function MagicLinkAuth(props: MagicLinkAuthProps) {
  useQueryParams([
    {
      name: "token",
      type: { type: "Uuid" },
    },
  ]);
  return (
    <Authorize
      procedure={(s) => {
        s.defScalar("user_id", props.getUserFromToken(sql`token`));
        s.returnUnless(sql`user_id is not null`, false);
        s.setCurrentUser(sql`user_id`);
        s.return(true);
      }}
      unauthorized={<div>You are not authorized to access this page</div>}
    >
      {props.children}
    </Authorize>
  );
}
