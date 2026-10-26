import { FormICtxKey } from "std/ictx";
import { selectColumn, sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { TableControlOpts } from "std/system";
import { system } from "std/system";
import { Show, useOptionalICtx, useState } from "std/ui";
import { AutoInsertDialog } from "./auto_insert_dialog";
import { CircularProgress } from "./circular_progress";
import { EachSelect } from "./each_select";
import { ListItemDecorator } from "./list";
import { MaterialIcon } from "./material_icon";
import { QueryCombobox } from "./query_combobox";
import { buildRankedSearchTargets } from "std/search_utils";

const DEFAULT_FUZZY_CONFIG = sql.lit`null`;

function buildBestRankExpr(rankExprs: Sql[]) {
  if (rankExprs.length === 0) {
    return sql.null;
  }
  let best = rankExprs[0];
  for (let i = 1; i < rankExprs.length; i++) {
    best = sql`case
      when ${best} is null then ${rankExprs[i]}
      when ${rankExprs[i]} is null then ${best}
      when ${best} <= ${rankExprs[i]} then ${best}
      else ${rankExprs[i]}
    end`;
  }
  return best;
}

/**
 * Props for {@link TableRecordSelect}. Extends {@link TableControlOpts}; the
 * control type (Combobox / Select / Custom) comes from the table's own
 * `control` config.
 */
export interface TableRecordSelectProps extends TableControlOpts {
  /** Name of the `db` table whose records can be selected. */
  tableName: string;
  className?: string;
  /** Suppress the inline "Add …" dialog-insert option even if the table enables it. */
  disableDialogInsert?: boolean;
  /** Prefer exact and prefix matches before looser fuzzy matches. Defaults to true. */
  preferExactPrefixMatches?: boolean;
  /** Optional label prefix to prefer when exact/prefix ranking otherwise ties. */
  preferredLabelPrefix?: string;
  /**
   * Commit the first result when Enter or Tab is pressed after typing without
   * first highlighting an option. Tab keeps its native focus traversal.
   */
  selectFirstResultOnEnterOrTab?: boolean;
}

/**
 A component for letting the user select a record from a table, typically by typing a search query.

 @category UI Component
 @examples
 [Example](../pages/datagrid_internals/toolbar_filter.tsx)
 */
export function TableRecordSelect(props: TableRecordSelectProps) {
  const tableModel = system.db.tables[props.tableName];
  if (!tableModel) {
    throw new Error(`Table ${props.tableName} not found`);
  }
  const selectInfo = tableModel.control ?? { type: "Combobox" };
  const preferExactPrefixMatches = props.preferExactPrefixMatches ?? true;
  const where = props.where
    ? sql` where ${props.where}`
    : (selectInfo as any).where
    ? sql` where ${(selectInfo as any).where}`
    : sql``;
  switch (selectInfo.type) {
    case "Combobox": {
      if (!tableModel.recordDisplayName) {
        throw new Error(
          `Tried getting a table record select for table ${props.tableName} when table does not have recordDisplayName`,
        );
      }

      let searchConfig = tableModel.getSearchConfig();
      if (!searchConfig) {
        throw new Error(`Table ${props.tableName} does not have searchConfig`);
      }
      if (props.where) {
        searchConfig = {
          ...searchConfig,
          filterExpr: sql.and(searchConfig.filterExpr ?? true, props.where),
        };
      }
      const nameExpr = tableModel.recordDisplayName.expr(
        ...tableModel.recordDisplayName.fields.map(
          (f) => sql`${tableModel.ident}.${sql.ref(f)}`,
        ),
      );
      const selectColumns = [
        selectColumn(nameExpr, "label"),
        selectColumn(sql`id`),
        ...(selectInfo.extraSelectColumns ?? []),
        ...(props.extraSelectColumns ?? []),
      ];
      const selectPart = sql`select ${selectColumns}`;
      // Number rows after the query's order by so keyboard navigation follows display order.
      const withIndex = (query: Sql) =>
        sql`select ordered_results.*, rank() over () - 1 as index from (${query}) as ordered_results`;
      const limit = selectInfo.limit ?? 50;
      let emptyQuery = withIndex(
        sql`${selectPart} from ${tableModel.identWithDb} ${where} order by id desc limit ${limit}`,
      );
      if (props.emptyQuery) {
        emptyQuery = withIndex(sql`${selectPart} ${props.emptyQuery}`);
      } else if (selectInfo.emptyQuery) {
        emptyQuery = withIndex(sql`${selectPart} ${selectInfo.emptyQuery}`);
      }
      const resetWatch = useOptionalICtx(FormICtxKey)?.resetKey;
      const initialTextWatch = [resetWatch, props.value, props.initialInputText]
        .filter(Boolean) as Sql[];
      useState({
        watch: initialTextWatch,
        procedure: (s) => {
          s.defScalar("initial_text", {
            type: "String",
            expr: props.initialInputText ?? sql.lit``,
          });
          s.if(sql.isNotNull(props.value), (s) => {
            s.setScalar(
              "initial_text",
              sql`coalesce((select ${nameExpr} from ${tableModel.identWithDb} where id = ${props.value}), ${
                props.initialInputText ?? sql.lit``
              })`,
            );
          });
        },
      });
      const dialogInsert = props.disableDialogInsert
        ? undefined
        : selectInfo.dialogInsert ?? props.dialogInsert;
      return (
        <QueryCombobox
          resultTableInferQuery={emptyQuery}
          immediateFocus={props.immediateFocus}
          className={props.className}
          id={props.id}
          error={props.error}
          notFoundSnackbar={props.comboboxNotFoundSnackbar}
          clearOnSelect={props.clearOnSelect}
          selectFirstResultOnEnterOrTab={props.selectFirstResultOnEnterOrTab}
          populateResultTable={(s, query, resultTable) => {
            s.conditional({
              condition: sql`trim(${query}) = ''`,
              then: (s) => {
                if (!props.comboboxNoEmptyList) {
                  s.modify(sql.insertQuery(resultTable, emptyQuery));
                }
              },
              else: (s) => {
                s.defScalar(
                  "record_select_query",
                  sql`trim(${query})`,
                );
                const rankedQuery = sql`record_select_query`;
                const searchTargets = buildRankedSearchTargets(
                  searchConfig,
                  tableModel.name,
                );
                const useDetailedTierRanking = preferExactPrefixMatches &&
                  !!props.preferredLabelPrefix;
                const rankExpressions = searchTargets.map((target) => {
                  const matchesTarget =
                    sql`fuzzy_match(${rankedQuery}, ${target.expr}, ${DEFAULT_FUZZY_CONFIG})`;
                  const rankForTarget =
                    sql`fuzzy_rank_key(${rankedQuery}, ${target.expr}, ${DEFAULT_FUZZY_CONFIG}, ${target.priority})`;
                  if (!useDetailedTierRanking) {
                    return sql`case when ${matchesTarget} then ${rankForTarget} else null end`;
                  }
                  const normalizedQuery = sql`upper(${rankedQuery})`;
                  const normalizedTarget = sql`upper(${target.expr})`;
                  const tokenPrefixMatch = sql`
                    ${normalizedTarget} like '% ' || ${normalizedQuery} || '%'
                    or ${normalizedTarget} like '%(' || ${normalizedQuery} || '%'
                  `;
                  const preferredLabelOffset = props.preferredLabelPrefix
                    ? sql`
                      case
                        when upper(${nameExpr}) like ${
                      sql.lit(props.preferredLabelPrefix.toUpperCase())
                    } || '%'
                          then 0
                        else 500
                      end
                    `
                    : sql`0`;
                  return sql`
                      case
                        when ${normalizedTarget} = ${normalizedQuery}
                          then ${target.priority}
                        when ${normalizedTarget} like ${normalizedQuery} || '%'
                          then 1000 + ${target.priority}
                        when ${tokenPrefixMatch}
                          then 10000 + ${preferredLabelOffset} + ${target.priority}
                        when ${normalizedTarget} like '%' || ${normalizedQuery} || '%'
                          then 100000 + ${target.priority}
                        when ${matchesTarget}
                          then 1000000 + ${rankForTarget}
                        else null
                      end
                    `;
                });
                const bestRankExpr = buildBestRankExpr(rankExpressions);
                let orderByExpr = bestRankExpr;
                if (
                  preferExactPrefixMatches && !props.preferredLabelPrefix &&
                  searchTargets.length > 0
                ) {
                  const normalizedQuery = sql`upper(${rankedQuery})`;
                  const normalizedPrimaryTarget = sql`upper(${
                    searchTargets[0].expr
                  })`;
                  const primaryMatchTier = sql`
                    case
                      when ${normalizedPrimaryTarget} = ${normalizedQuery}
                        then 0
                      when ${normalizedPrimaryTarget} like ${normalizedQuery} || '%'
                        then 1
                      else 2
                    end
                  `;
                  orderByExpr = sql`${primaryMatchTier}, ${bestRankExpr}`;
                }
                const whereClause = searchConfig.filterExpr
                  ? sql`${searchConfig.filterExpr} and ${bestRankExpr} is not null`
                  : sql`${bestRankExpr} is not null`;

                s.modify(
                  sql`insert into ${resultTable}
                    ${
                    withIndex(sql`${selectPart}
                    from ${tableModel.identWithDb}
                    where ${whereClause}
                    order by ${orderByExpr}, ${tableModel.primaryKeyIdent}
                    limit ${limit}`)
                  }`,
                );
              },
            });
          }}
          onBlur={() => {}}
          onClear={(s) => {
            if (props.onComboboxSelectValue) {
              s.defRecord("search_result", {
                query: sql`select * from result limit 0`,
                allowNoRead: true,
              });
              props.onComboboxSelectValue(
                s,
                sql.null,
                sql.null,
                sql.ref("search_result"),
              );
            } else if (!props.disableOnClear) {
              props.onSelectValue?.(s, sql.null);
            }
          }}
          onSelect={(s, result) => {
            props.onComboboxSelectValue
              ? props.onComboboxSelectValue(
                s as any,
                sql`${result}.id`,
                sql`${result}.label`,
                result,
              )
              : props.onSelectValue?.(s as any, sql`${result}.id`);
          }}
          size={props.size}
          color={props.color}
          variant={props.variant}
          placeholder={props.placeholder}
          initialInputText={sql`initial_text`}
          sx={props.sx}
          displayItem={props.displayItem ?? selectInfo.displayItem}
          addItem={dialogInsert
            ? {
              component: (props) => (
                <>
                  <ListItemDecorator>
                    <MaterialIcon icon="Add" />
                  </ListItemDecorator>
                  Add "{props.query}"
                </>
              ),
              onClick: (s, { openScalar }) => {
                s.setScalar(openScalar, true);
              },
              dialog: (props) => {
                const nameField =
                  tableModel.recordDisplayName!.fields.length === 1
                    ? tableModel.recordDisplayName!.fields[0]
                    : undefined;
                const fieldOverrides = nameField
                  ? { [nameField]: { initialValue: props.query } }
                  : undefined;
                return (
                  <AutoInsertDialog
                    table={tableModel.name}
                    bindScalar={props.openScalar}
                    fieldOverrides={fieldOverrides}
                    beforeTransactionCommit={(s) => {
                      s.defScalar(
                        "inserted_record",
                        sql`last_record_id(${tableModel.identWithDb})`,
                      );
                    }}
                    afterTransactionCommit={(s) => {
                      s.defScalar(
                        "label",
                        sql`(select ${nameExpr} from ${tableModel.identWithDb} where id = inserted_record)`,
                      );
                      props.onConfirm(s, {
                        id: sql`inserted_record`,
                        label: sql`label`,
                      });
                    }}
                  />
                );
              },
            }
            : undefined}
          endDecorator={props.endDecorator}
        />
      );
    }
    case "Select": {
      if (!tableModel.recordDisplayName) {
        throw new Error(
          `Tried getting a table record select when table ${props.tableName} does not have recordDisplayName`,
        );
      }
      const nameExpr = tableModel.recordDisplayName.expr(
        ...tableModel.recordDisplayName.fields.map(
          (f) => sql`${tableModel.ident}.${sql.ref(f)}`,
        ),
      );
      const selectPart = sql`select ${nameExpr} as label, id `;
      const emptyQuery =
        sql`${selectPart} from ${tableModel.identWithDb}${where} order by id desc`;
      useState({
        procedure: (s) => {
          s.defTable("record", emptyQuery);
        },
        statusScalar: "select_query_status",
      });
      return (
        <>
          <EachSelect
            className={props.className}
            size={props.size}
            color={props.color}
            variant={props.variant}
            error={props.error}
            id={props.id}
            value={props.value}
            table="record"
            optionLabel="label"
            optionValue="id"
            onChange={(s) => {
              props.onSelectValue?.(s, sql`cast(target_value as bigint)`);
            }}
            endDecorator={
              <Show when={sql`select_query_status = 'fallback_triggered'`}>
                <CircularProgress
                  size={props.size === "xs" ? "xs" : "sm"}
                />
              </Show>
            }
          />
        </>
      );
    }
    case "Custom": {
      const Custom = selectInfo.f;
      return <Custom {...props} />;
    }
  }
}
