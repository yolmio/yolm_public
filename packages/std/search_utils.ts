import { sql } from "./sql_utils";
import type { Sql } from "./sql_utils";
import type { RankedSearchTable } from "./statements";

export interface RankedSearchTarget {
  expr: Sql;
  priority: number;
}

function buildFieldExpr(tableAlias: string, field: string | Sql): Sql {
  return sql`coalesce(cast(${sql.ref(tableAlias)}.${
    typeof field === "string" ? sql.ref(field) : field
  } as string), '')`;
}

function concatWithSpaces(parts: Sql[]): Sql {
  if (parts.length === 0) return sql.lit`' '`;
  if (parts.length === 1) return parts[0];
  const concatParts: Sql[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) concatParts.push(sql.lit` `);
    concatParts.push(parts[i]);
  }
  return sql.concat(...concatParts);
}

/**
 * Builds search targets in priority order.
 * Each field group becomes one target expression, while simple fields become
 * single-field targets.
 */
export function buildRankedSearchTargets(
  searchConfig: RankedSearchTable,
  tableAlias: string,
): RankedSearchTarget[] {
  const rankedTargets: {
    fields: (string | Sql)[];
    priority: number;
    order: number;
  }[] = [];
  let order = 0;
  if (searchConfig.fields) {
    for (const field of searchConfig.fields) {
      rankedTargets.push({
        fields: [field.field],
        priority: field.priority,
        order: order++,
      });
    }
  }
  if (searchConfig.fieldGroups) {
    for (const group of searchConfig.fieldGroups) {
      rankedTargets.push({
        fields: group.fields,
        priority: group.priority,
        order: order++,
      });
    }
  }

  rankedTargets.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.order - b.order;
  });

  const seenStringFields = new Set<string>();
  const seenSqlFields = new Set<Sql>();
  const output: RankedSearchTarget[] = [];
  for (const target of rankedTargets) {
    if (target.fields.length === 1) {
      const field = target.fields[0];
      if (typeof field === "string") {
        if (seenStringFields.has(field)) continue;
        seenStringFields.add(field);
      } else {
        if (seenSqlFields.has(field)) continue;
        seenSqlFields.add(field);
      }
    }
    output.push({
      expr: concatWithSpaces(
        target.fields.map((field) => buildFieldExpr(tableAlias, field)),
      ),
      priority: target.priority,
    });
  }
  return output;
}

/**
 * Builds a SQL expression that concatenates all searchable fields from a search configuration.
 * Used for fuzzy matching against multiple fields in a table.
 *
 * @param searchConfig - The search configuration containing fields to search
 * @param tableAlias - The SQL table alias to use when referencing fields
 * @returns A SQL expression that concatenates all searchable fields with spaces
 */
export function buildSearchExpression(
  searchConfig: RankedSearchTable,
  tableAlias: string,
): Sql {
  const targets = buildRankedSearchTargets(searchConfig, tableAlias);
  return concatWithSpaces(targets.map((target) => target.expr));
}

export type QuickSearchFieldMode = "fuzzy" | "contains" | "exact";

export interface QuickSearchTargetResolved {
  /**
   * Pre-built SQL expression yielding the haystack string per row. Should already be
   * cast-as-string and coalesced to the empty string. May span multiple fields (groups).
   */
  expr: Sql;
  mode: QuickSearchFieldMode;
  /**
   * Lower wins. Used both as a tiebreaker within a tier and (for fuzzy) as the bias
   * parameter to `fuzzy_rank_key`. Must be < {@link CONTAINS_RANK_TIER}.
   */
  priority: number;
  /**
   * Optional SQL boolean expression evaluated at dynamic-query assembly time (i.e. it
   * may reference the query scalar). When present and false, this target is dropped
   * from the runtime predicate and rank-key entirely — useful for skipping numeric /
   * uuid columns when the user input can't be cast to that type.
   */
  inputGate?: Sql;
}

export interface ResolvedQuickSearch {
  targets: QuickSearchTargetResolved[];
  rank: boolean;
  placeholder: string;
}

export interface QuickSearchSqlFragments {
  /**
   * SQL expression that, at dynamic-query construction time, evaluates to the predicate
   * text to be embedded in the WHERE clause. Includes an empty-query short-circuit so the
   * predicate is a no-op when the search input is empty.
   */
  predicate: Sql;
  /**
   * SQL expression that, at dynamic-query construction time, evaluates to the rank-key
   * text to be embedded in the ORDER BY clause. The rank-key is smaller = better match,
   * null when no field matches.
   */
  rankKey: Sql;
}

/**
 * Rank tiers ensure exact matches sort before contains matches sort before fuzzy
 * matches, regardless of `fuzzy_rank_key`'s output range. Per-target `priority`
 * (which must be smaller than the next tier) acts as a tiebreaker within a tier.
 *
 * Final per-target rank values:
 * - `exact`    → `priority`
 * - `contains` → `CONTAINS_RANK_TIER + priority`
 * - `fuzzy`    → `FUZZY_RANK_TIER + fuzzy_rank_key(query, expr, null, priority)`
 */
export const CONTAINS_RANK_TIER = 1_000_000;
export const FUZZY_RANK_TIER = 1_000_000_000;

/**
 * Builds SQL fragments for a datagrid quick-search. Each fragment is a SQL expression
 * that — at the time the datagrid's dynamic query string is being assembled — evaluates
 * to the SQL text to splice into the runtime query.
 *
 * @param targets - resolved targets (haystack expr + mode + priority)
 * @param queryScalar - Sql expression resolving to the user-typed search string in the
 *                     scope where the dynamic query is being built (e.g. `sql\`q\``). May
 *                     evaluate to NULL — coalesced internally.
 */
export function buildQuickSearchSqlFragments(
  targets: QuickSearchTargetResolved[],
  queryScalar: Sql,
): QuickSearchSqlFragments {
  if (targets.length === 0) {
    throw new Error("buildQuickSearchSqlFragments: targets must be non-empty");
  }
  for (const t of targets) {
    if (t.priority < 0 || t.priority >= CONTAINS_RANK_TIER) {
      throw new Error(
        `buildQuickSearchSqlFragments: priority must be in [0, ${CONTAINS_RANK_TIER}); got ${t.priority}`,
      );
    }
  }

  // SQL literal of the user's typed text, computed at dynamic-query assembly time.
  // `coalesce(…, '')` keeps the function call valid when the scalar is NULL (e.g. the
  // URL param is unset). Note: every reference to the search input goes through this
  // expression so the value is captured at construction — the dynamic SQL itself
  // never references the UI scalar (which isn't in scope when the SQL executes).
  const literalQuery = sql`literal.string(coalesce(${queryScalar}, ''))`;

  // Each target contributes one Sql producing either its match text (string) or NULL
  // when its input gate fails — so gated-out targets vanish from the runtime predicate
  // instead of evaluating to a guaranteed-false branch on every row.
  const matchTextSqls: Sql[] = [];
  // Each target contributes one Sql producing the rank-text already wrapped in
  // `coalesce(<case>, sentinel)` so the operand is always a valid `least` arg.
  const rankTextSqls: Sql[] = [];
  const SENTINEL = "9000000000000000000";

  for (const t of targets) {
    const haystackText = t.expr.toSQL();
    let matchTextLiteral: Sql;
    let rankConstText: string;
    switch (t.mode) {
      case "fuzzy":
        matchTextLiteral = sql.concat(
          `fuzzy_match(`,
          literalQuery,
          `, ${haystackText}, null)`,
        );
        rankConstText = "";
        break;
      case "contains":
        matchTextLiteral = sql.concat(
          `contains(lower(${haystackText}), lower(`,
          literalQuery,
          `))`,
        );
        rankConstText = String(CONTAINS_RANK_TIER + t.priority);
        break;
      case "exact":
        matchTextLiteral = sql.concat(
          `lower(${haystackText}) = lower(`,
          literalQuery,
          `)`,
        );
        rankConstText = String(t.priority);
        break;
    }
    // The full match-text SQL — what gets spliced into the WHERE predicate as one OR
    // operand at runtime.
    const matchText: Sql = matchTextLiteral;
    // The full rank-text SQL — `case when match then <rank-tier-value> else null end`.
    let rankText: Sql;
    if (t.mode === "fuzzy") {
      rankText = sql.concat(
        `case when `,
        matchTextLiteral,
        ` then (${FUZZY_RANK_TIER} + fuzzy_rank_key(`,
        literalQuery,
        `, ${haystackText}, null, ${t.priority})) else null end`,
      );
    } else {
      rankText = sql.concat(
        `case when `,
        matchTextLiteral,
        ` then ${rankConstText} else null end`,
      );
    }

    // Wrap rank-text in `coalesce(<case>, sentinel)` so per-row no-matches don't break
    // `least(…)`. We do this BEFORE the input-gate wrap so a gated-out target falls back
    // to the sentinel directly (vs. emitting a null operand that would produce invalid
    // `coalesce(, sentinel)` SQL when concat'd at runtime).
    const wrappedRankText = sql.concat(
      `coalesce(`,
      rankText,
      `, ${SENTINEL})`,
    );

    if (t.inputGate) {
      matchTextSqls.push(
        sql`case when ${t.inputGate} then ${matchText} else null end`,
      );
      rankTextSqls.push(
        sql`case when ${t.inputGate} then ${wrappedRankText} else ${
          sql.lit(SENTINEL)
        } end`,
      );
    } else {
      matchTextSqls.push(matchText);
      rankTextSqls.push(wrappedRankText);
    }
  }

  // Empty-input short-circuit + gate-aware OR/least construction. Evaluated at the
  // dynamic-query assembly layer, where the query scalar and gates are in scope.
  const predicate = sql`case
    when trim(coalesce(${queryScalar}, '')) = '' then 'true'
    else '(' || coalesce(
      (select string_agg(t, ' or ') from (values ${
    rowsValues(matchTextSqls)
  }) as v(t) where t is not null),
      'false'
    ) || ')'
  end`;

  // Rank-key text: `least(<r1>, <r2>, …, <sentinel>)` where each `<rN>` is already
  // `coalesce(<case>, sentinel)`. The trailing sentinel guarantees `least(…)` always
  // has ≥ 2 args (Yolm SQL requires that), and is larger than any real rank so it
  // never wins.
  const rankKeyParts: (Sql | string)[] = [`least(`];
  rankTextSqls.forEach((r, i) => {
    if (i > 0) rankKeyParts.push(`, `);
    rankKeyParts.push(r);
  });
  rankKeyParts.push(`, ${SENTINEL})`);
  const rankKey = sql.concat(...rankKeyParts);

  return { predicate, rankKey };
}

/** Build a SQL VALUES row-list `(e1), (e2), (e3)` as a raw SQL fragment. */
function rowsValues(items: Sql[]): Sql {
  return sql(items.map((item) => `(${item.toSQL()})`).join(", "));
}
