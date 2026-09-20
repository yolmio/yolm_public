import { RecordPage } from "pages/record_page";
import type { RecordPageProps } from "pages/record_page";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { notificationAppHref } from "./surfaces";
import type { UserNotificationDestination } from "./user_notifications_block";

/** One record identity shared by notification producers and destination pages. */
export interface RecordNotificationDestinationOptions {
  key: string;
  table: string;
  /** Relative route containing exactly one `{id}`, e.g. `/orders/{id}`. */
  path: string;
  /** Optional cross-app routing, evaluated when opening, not when publishing. */
  resolveHref?: (path: Sql) => Sql;
  domain?: string;
}

/** A destination reference; the notification package owns its stored encoding. */
export interface UserNotificationTarget {
  destination: RecordNotificationDestination;
  id: Sql;
}

/**
 * Declare once, publish with `.at(id)`, and render with `.RecordPage`.
 */
export class RecordNotificationDestination {
  private readonly prefix: string;
  private readonly suffix: string;

  constructor(readonly opts: RecordNotificationDestinationOptions) {
    const parts = opts.path.split("{id}");
    if (!opts.key || !opts.path.startsWith("/") || parts.length !== 2) {
      throw new Error(
        "Record notification destinations require a key and a relative path with one {id}",
      );
    }
    if (opts.domain && opts.resolveHref) {
      throw new Error("Choose domain or resolveHref, not both");
    }
    this.prefix = parts[0];
    this.suffix = parts[1];
  }

  at(id: Sql): UserNotificationTarget {
    return { destination: this, id };
  }

  path(id: Sql): Sql {
    return sql`${sql.lit(this.prefix)} || cast(${id} as string) || ${
      sql.lit(this.suffix)
    }`;
  }

  href(id: Sql): Sql {
    const path = this.path(id);
    return this.opts.domain
      ? notificationAppHref(this.opts.domain, path)
      : this.opts.resolveHref?.(path) ?? path;
  }

  /** Only package-published targets are accepted; URLs are not record identity. */
  private recordId(notification: Sql): Sql {
    return sql`case when ${notification}.payload->>'targetKind' = ${
      sql.lit(this.opts.key)
    }
      then try_cast(${notification}.payload->>'targetId' as bigint) end`;
  }

  destination(): UserNotificationDestination {
    return {
      href: (notification) => this.href(this.recordId(notification)),
    };
  }

  /** A standard record page using the declared table and route. */
  RecordPage = (props: Omit<RecordPageProps, "table" | "path">) => (
    <RecordPage
      {...props}
      table={this.opts.table}
      path={this.opts.path.replace("{id}", "{record_id:id}")}
    />
  );
}

/** Combine a source's supported record destinations; unknown targets fail closed. */
export function recordNotificationDestinations(
  destinations: readonly RecordNotificationDestination[],
): UserNotificationDestination {
  if (
    !destinations.length ||
    new Set(destinations.map((d) => d.opts.key)).size !== destinations.length
  ) {
    throw new Error(
      "Record notification destination keys must be nonempty and unique",
    );
  }
  const adapters = destinations.map((d) => d.destination());
  return {
    href: (notification) =>
      sql`coalesce(${
        adapters.map((d) => d.href(notification))
      }, cast(null as string))`,
  };
}
