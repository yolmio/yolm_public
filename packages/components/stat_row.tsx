import { Alert } from "components/alert";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Skeleton } from "components/skeleton";
import { Typography } from "components/typography";
import type { TypographyOpts } from "components/typography";
import { Data } from "std/data";
import { sql } from "../std/sql_utils";
import type { NumericExpr, Sql } from "../std/sql_utils";
import type { StateStatementsOrFn } from "std/statements";
import type { StyleObject } from "std/style_types";
import { createStyles, getVariantStyle } from "std/style_utils";
import { Match, Switch, useSourceMap } from "std/ui";
import type { Node } from "std/ui";
import type { Color } from "./types";

/** Definition of a single statistic rendered by {@link Stat} inside a {@link StatRow}. */
export interface StatProps {
  title: Node;
  titleProps?: TypographyOpts;
  color?: Color;
  /** Procedure run before the `value`/`previous`/`trend` expressions are evaluated; use it to load any data those expressions reference. */
  procedure?: StateStatementsOrFn;
  /** Expression for the headline current value. */
  value: NumericExpr;
  /** Formats {@link StatProps.value} for display (e.g. currency, percent). */
  formatValue?: (value: NumericExpr) => Sql;
  /** Optional prior-period value shown as a "from …" comparison. */
  previous?: NumericExpr;
  /** Formats {@link StatProps.previous} for display. */
  formatPrevious?: (value: NumericExpr) => Sql;
  /** Optional signed change shown as a colored trend chip; positive is success, negative danger. */
  trend?: NumericExpr;
  /** Formats {@link StatProps.trend}; defaults to a percent display. */
  formatTrend?: (value: NumericExpr) => Sql;
}

/** Props for {@link StatRow}. */
export interface StatRowProps {
  header?: Node;
  sx?: StyleObject;
  className?: string;
  /** The statistics to display; must contain 2 to 4 entries. */
  stats: StatProps[];
}

const styles = createStyles({
  root: {
    gridColumnSpan: "full",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  card: (_, statCount: number) => {
    let mediaQuery: StyleObject = {};
    switch (statCount) {
      case 2: {
        mediaQuery = {
          md: {
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          },
        };
        break;
      }
      case 3: {
        mediaQuery = {
          lg: {
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          },
        };
        break;
      }
      case 4: {
        mediaQuery = {
          md: {
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          },
          xl: {
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          },
        };
        break;
      }
    }
    return {
      display: "grid",
      gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
      border: "1px solid",
      borderColor: "divider",
      borderRadius: "md",
      boxShadow: "sm",
      ...getVariantStyle("outlined", "neutral"),
      ...mediaQuery,
    };
  },
  stat: (_, statCount: number) => {
    let mediaQuery: StyleObject = {};
    switch (statCount) {
      case 2: {
        mediaQuery = {
          "&:not(:last-child)": {
            borderBottom: "1px solid",
            borderColor: "divider",
            md: {
              borderBottom: "none",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          },
        };
        break;
      }
      case 3: {
        mediaQuery = {
          "&:not(:last-child)": {
            borderBottom: "1px solid",
            borderColor: "divider",
            lg: {
              borderBottom: "none",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          },
        };
        break;
      }
      case 4: {
        mediaQuery = {
          borderBottom: "1px solid",
          borderColor: "divider",
          xl: {
            borderRight: "1px solid",
            borderColor: "divider",
            borderBottom: "none",
          },
          "&:nth-child(odd)": {
            md: {
              borderRight: "1px solid",
              borderColor: "divider",
            },
          },
          // last two elements
          "&:nth-child(n+3)": {
            md: {
              borderBottom: "none",
            },
          },
        };
        break;
      }
    }
    return {
      display: "flex",
      flexDirection: "column",
      p: 6,
      ...mediaQuery,
    };
  },
  statAndPreviousWrapper: {
    display: "flex",
    alignItems: "baseline",
    gap: 2,
  },
  skeletonStyles: {
    width: "75%",
    height: "100%",
  },
});

/**
 Stat component for displaying a single statistic within a StatRow.

 This component renders a single statistic with optional previous value and trend.
 It handles loading states, errors, and different data formatting options.

 @category UI Component

 @param props.title The title of the statistic
 @param props.procedure Optional state procedure for fetching data
 @param props.value The current value of the statistic
 @param props.formatValue Optional function to format the current value
 @param props.previous Optional previous value of the statistic
 @param props.formatPrevious Optional function to format the previous value
 @param props.trend Optional trend value (percentage change)
 @param props.formatTrend Optional function to format the trend value
 @param props.statCount The total number of stats in the parent StatRow

*/
export function Stat(
  props: StatProps & {
    statCount: number;
  },
) {
  useSourceMap(`Stat ${props.title}`);
  const value = (
    <Typography level="h4" color={props.color ?? "primary"}>
      {props.formatValue ? props.formatValue(sql`value`) : sql`value`}
    </Typography>
  );
  const valueAndPrevious = props.previous
    ? (
      <div sx={styles.statAndPreviousWrapper}>
        {value}
        <Typography level="body-sm">
          {sql.concat(
            "from ",
            props.formatPrevious
              ? props.formatPrevious(sql`previous`)
              : sql`previous`,
          )}
        </Typography>
      </div>
    )
    : value;
  let cellValue = valueAndPrevious;
  if (props.trend) {
    cellValue = (
      <div className="flex justify-between">
        {valueAndPrevious}
        <Chip
          variant="soft"
          color="success"
          conditionalVariants={[
            {
              when: sql`trend < 0`,
              variant: "soft",
              color: "danger",
            },
          ]}
          startDecorator={
            ////Example_Switch_Start


              <Switch>
                <Match when={sql`trend > 0`}>
                  <MaterialIcon icon="TrendingUp" />
                </Match>
                <Match when={sql`trend = 0`}>
                  <MaterialIcon icon="TrendingFlat" />
                </Match>
                <Match when={sql`trend < 0`}>
                  <MaterialIcon icon="TrendingDown" />
                </Match>
              </Switch>


            ////Example_Switch_End
          }
        >
          {props.formatTrend
            ? props.formatTrend(sql`trend`)
            : sql`format.percent(trend)`}
        </Chip>
      </div>
    );
  }
  return (
    <div sx={styles.stat(props.statCount)}>
      <Typography level="title-md" {...props.titleProps}>
        {props.title}
      </Typography>
      <Data
        pendingFallback={
          <Skeleton variant="text" level="h4" sx={styles.skeletonStyles} />
        }
        errorFallback={
          <Alert variant="soft" color="danger" size="sm" startIcon="Error">
            Error
          </Alert>
        }
        procedure={(s) => {
          s.statements(props.procedure);
          s.defScalar("value", {
            expr: props.value,
            allowNoRead: true,
          });
          if (props.previous) {
            s.defScalar("previous", {
              expr: props.previous!,
              allowNoRead: true,
            });
          }
          if (props.trend) {
            s.defScalar("trend", {
              expr: props.trend!,
              allowNoRead: true,
            });
          }
        }}
      >
        {cellValue}
      </Data>
    </div>
  );
}

/**
 StatRow component for displaying a row of statistics.

 This component renders a row of 2-4 statistics, each represented by a Stat component.
 It includes a header and a flexible layout that adjusts based on the number of stats.

 @category UI Component

 @param props.header The header text for the stat row
 @param props.sx
 @param props.stats An array of StatProps objects, each representing a statistic to display

  @examples
  [Example](../../examples/legal/apps/legal.yolmstaging.net.tsx)
*/
export function StatRow(props: StatRowProps) {
  if (props.stats.length > 4 || props.stats.length < 2) {
    throw new Error("Only 2-4 stats are supported in stat_row");
  }
  return (
    <div
      className={props.className}
      sx={props.sx ? [styles.root, props.sx] : styles.root}
    >
      <Typography level="h4">{props.header}</Typography>
      <div sx={styles.card(props.stats.length)}>
        {props.stats.map((stat) => (
          <Stat {...stat} statCount={props.stats.length} />
        ))}
      </div>
    </div>
  );
}
