import { sql } from "std/sql_utils";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Select } from "components/select";
import { Typography } from "components/typography";
import { Each, Show } from "std/ui";
import { Data } from "std/data";
import { Table } from "components/table";
import { Checkbox } from "components/checkbox";

export function PLDashboard() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_period", sql.lit`current_month`);

        // Revenue metrics
        s.defScalar(
          "total_revenue",
          sql`
      (select coalesce(sum(credit - debit), 0)
       from db.journal_lines jl
       join db.journal_entries je on jl.journal_id = je.id
       where jl.account in (select account_code from db.chart_of_accounts where account_type = 'revenue')
         and case ui.selected_period
           when 'current_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date())
           when 'last_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '1 month')
           when 'current_quarter' then date_trunc('quarter', je.entry_date) = date_trunc('quarter', current_date())
           when 'current_year' then date_trunc('year', je.entry_date) = date_trunc('year', current_date())
           else true
         end)
    `,
        );

        // Direct costs
        s.defScalar(
          "total_direct_costs",
          sql`
      (select coalesce(sum(debit - credit), 0)
       from db.journal_lines jl
       join db.journal_entries je on jl.journal_id = je.id
       join db.chart_of_accounts coa on jl.account = coa.account_code
       where coa.account_category = 'direct_costs'
         and case ui.selected_period
           when 'current_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date())
           when 'last_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '1 month')
           when 'current_quarter' then date_trunc('quarter', je.entry_date) = date_trunc('quarter', current_date())
           when 'current_year' then date_trunc('year', je.entry_date) = date_trunc('year', current_date())
           else true
         end)
    `,
        );

        // Gross margin
        s.defScalar("gross_margin", sql`total_revenue - total_direct_costs`);
        s.defScalar(
          "gross_margin_percent",
          sql`case when total_revenue > 0 then round((gross_margin / total_revenue) * 100, 2) else 0 end`,
        );

        // Operating expenses
        s.defScalar(
          "total_opex",
          sql`
      (select coalesce(sum(debit - credit), 0)
       from db.journal_lines jl
       join db.journal_entries je on jl.journal_id = je.id
       join db.chart_of_accounts coa on jl.account = coa.account_code
       where coa.account_type = 'expense'
         and case ui.selected_period
           when 'current_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date())
           when 'last_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '1 month')
           when 'current_quarter' then date_trunc('quarter', je.entry_date) = date_trunc('quarter', current_date())
           when 'current_year' then date_trunc('year', je.entry_date) = date_trunc('year', current_date())
           else true
         end)
    `,
        );

        // Net income
        s.defScalar("net_income", sql`gross_margin - total_opex`);
        s.defScalar(
          "net_margin_percent",
          sql`case when total_revenue > 0 then round((net_income / total_revenue) * 100, 2) else 0 end`,
        );

        // Revenue by client
        s.defTable(
          "revenue_by_client",
          sql`
      select
        c.name as client_name,
        sum(o.client_cost) as revenue,
        count(distinct o.id) as order_count
      from db.orders o
      join db.clients c on o.client_id = c.id
      where o.status in ('completed', 'delivered', 'invoiced')
        and case ui.selected_period
          when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
          when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
          when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
          when 'current_year' then date_trunc('year', o.completed_at) = date_trunc('year', current_date())
          else true
        end
      group by c.name
      order by revenue desc
      limit 10
    `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">P&L Dashboard</Typography>
          <Select
            value={sql`selected_period`}
            onChange={(s) => s.setScalar("selected_period", sql`target_value`)}
            variant="outlined"
            size="sm"
          >
            <Select.Option value="current_month">Current Month</Select.Option>
            <Select.Option value="last_month">Last Month</Select.Option>
            <Select.Option value="current_quarter">
              Current Quarter
            </Select.Option>
            <Select.Option value="current_year">Current Year</Select.Option>
          </Select>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-4 gap-4">
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Revenue
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(total_revenue, 'USD')`}
            </Typography>
          </Card>

          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Gross Margin
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(gross_margin, 'USD')`}
            </Typography>
            <Typography level="body-sm" className="text-secondary">
              {sql`gross_margin_percent`}%
            </Typography>
          </Card>

          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Operating Expenses
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(total_opex, 'USD')`}
            </Typography>
          </Card>

          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Net Income
            </Typography>
            <Typography level="title-lg">
              <Show when={sql`net_income >= 0`}>
                <span className="text-success-600">
                  {sql`format.currency(net_income, 'USD')`}
                </span>
              </Show>
              <Show when={sql`net_income < 0`}>
                <span className="text-danger-600">
                  {sql`format.currency(net_income, 'USD')`}
                </span>
              </Show>
            </Typography>
            <Typography level="body-sm" className="text-secondary">
              {sql`net_margin_percent`}%
            </Typography>
          </Card>
        </div>

        {/* Revenue by Client */}
        <Card className="p-4">
          <Typography level="title-md" className="mb-4">
            Top Clients by Revenue
          </Typography>
          <Table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>% of Total</th>
              </tr>
            </thead>
            <tbody>
              <Each table="revenue_by_client" recordName="client">
                <tr>
                  <td>{sql`client.client_name`}</td>
                  <td>{sql`client.order_count`}</td>
                  <td>{sql`format.currency(client.revenue, 'USD')`}</td>
                  <td>
                    {sql`coalesce(round((client.revenue / nullif(total_revenue, 0)) * 100, 1), 0) || '%'`}
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </div>
    </Data>
  );
}

export function PLAnalysis() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_period", sql.lit`current_month`);
        s.defScalar("comparison_enabled", sql.false);
        s.defScalar("comparison_period", sql.lit`prior_month`);
        s.defScalar("view_type", sql.lit`summary`);

        // Get detailed P&L by account
        s.defTable(
          "pl_by_account",
          sql`
      with period_data as (
        select
          coa.account_code,
          coa.account_name,
          coa.account_type,
          coa.account_category,
          coa.sort_order,
          sum(case
            when coa.account_type = 'revenue' then jl.credit - jl.debit
            when coa.account_type = 'expense' then jl.debit - jl.credit
            else 0
          end) as current_amount
        from db.chart_of_accounts coa
        left join db.journal_lines jl on coa.account_code = jl.account
        left join db.journal_entries je on jl.journal_id = je.id and je.status = 'posted'
        where coa.account_type in ('revenue', 'expense')
          and case ui.selected_period
            when 'current_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date())
            when 'last_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '1 month')
            when 'current_quarter' then date_trunc('quarter', je.entry_date) = date_trunc('quarter', current_date())
            when 'current_year' then date_trunc('year', je.entry_date) = date_trunc('year', current_date())
            else true
          end
        group by coa.account_code, coa.account_name, coa.account_type, coa.account_category, coa.sort_order
      ),
      comparison_data as (
        select
          coa.account_code,
          sum(case
            when coa.account_type = 'revenue' then jl.credit - jl.debit
            when coa.account_type = 'expense' then jl.debit - jl.credit
            else 0
          end) as comparison_amount
        from db.chart_of_accounts coa
        left join db.journal_lines jl on coa.account_code = jl.account
        left join db.journal_entries je on jl.journal_id = je.id and je.status = 'posted'
        where coa.account_type in ('revenue', 'expense')
          and ui.comparison_enabled
          and case ui.comparison_period
            when 'prior_month' then
              case ui.selected_period
                when 'current_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '1 month')
                when 'last_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '2 months')
                else false
              end
            when 'prior_year' then
              case ui.selected_period
                when 'current_month' then date_trunc('month', je.entry_date) = date_trunc('month', current_date() - interval '1 year')
                when 'current_year' then date_trunc('year', je.entry_date) = date_trunc('year', current_date() - interval '1 year')
                else false
              end
            else false
          end
        group by coa.account_code
      )
      select
        pd.account_code,
        pd.account_name,
        pd.account_type,
        pd.account_category,
        pd.sort_order,
        coalesce(pd.current_amount, 0) as current_amount,
        coalesce(cd.comparison_amount, 0) as comparison_amount,
        coalesce(pd.current_amount, 0) - coalesce(cd.comparison_amount, 0) as variance,
        case
          when cd.comparison_amount != 0
          then ((pd.current_amount - cd.comparison_amount) / abs(cd.comparison_amount) * 100)
          else 0
        end as variance_pct
      from period_data pd
      left join comparison_data cd on pd.account_code = cd.account_code
      where pd.current_amount != 0 or cd.comparison_amount != 0
      order by pd.account_type desc, pd.sort_order
    `,
        );

        // Calculate category subtotals
        s.defTable(
          "category_totals",
          sql`
      select
        account_category,
        account_type,
        sum(current_amount) as category_current,
        sum(comparison_amount) as category_comparison,
        sum(variance) as category_variance
      from pl_by_account
      group by account_category, account_type
      order by account_type desc, account_category
    `,
        );

        // Summary totals
        s.defScalar(
          "total_revenue",
          sql`(select coalesce(sum(current_amount), 0) from pl_by_account where account_type = 'revenue')`,
        );
        s.defScalar(
          "total_cogs",
          sql`(select coalesce(sum(current_amount), 0) from pl_by_account where account_category in ('direct_costs', 'indirect_costs'))`,
        );
        s.defScalar(
          "total_opex",
          sql`(select coalesce(sum(current_amount), 0) from pl_by_account where account_type = 'expense' and account_category not in ('direct_costs', 'indirect_costs'))`,
        );
        s.defScalar("gross_profit", sql`total_revenue - total_cogs`);
        s.defScalar("operating_income", sql`gross_profit - total_opex`);
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">P&L Analysis</Typography>
          <div className="flex gap-2">
            <Select
              value={sql`view_type`}
              onChange={(s) => s.setScalar("view_type", sql`target_value`)}
              variant="outlined"
              size="sm"
            >
              <Select.Option value="summary">Summary View</Select.Option>
              <Select.Option value="detailed">Detailed View</Select.Option>
            </Select>
            <Button
              variant="outlined"
              startDecorator={<MaterialIcon icon="Download" />}
            >
              Export
            </Button>
          </div>
        </div>

        {/* Period Selection */}
        <Card className="p-4">
          <div className="flex gap-4 items-center">
            <Select
              value={sql`selected_period`}
              onChange={(s) =>
                s.setScalar("selected_period", sql`target_value`)}
              variant="outlined"
              size="sm"
            >
              <Select.Option value="current_month">
                Current Month
              </Select.Option>
              <Select.Option value="last_month">Last Month</Select.Option>
              <Select.Option value="current_quarter">
                Current Quarter
              </Select.Option>
              <Select.Option value="current_year">Current Year</Select.Option>
            </Select>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={sql`comparison_enabled`}
                onCheckboxChange={(s) =>
                  s.setScalar("comparison_enabled", sql`target_checked`)}
              />
              <label>Compare to:</label>
              <Select
                value={sql`comparison_period`}
                onChange={(s) =>
                  s.setScalar("comparison_period", sql`target_value`)}
                variant="outlined"
                size="sm"
              >
                <Select.Option value="prior_month">Prior Month</Select.Option>
                <Select.Option value="prior_year">Prior Year</Select.Option>
              </Select>
            </div>
          </div>
        </Card>

        {/* Summary View */}
        <Show when={sql`view_type = 'summary'`}>
          <Card className="p-6">
            <Table>
              <thead>
                <tr>
                  <th className="text-left">Category</th>
                  <th className="text-right">Current Period</th>
                  <Show when={sql`comparison_enabled`}>
                    <th className="text-right">Comparison</th>
                    <th className="text-right">Variance</th>
                    <th className="text-right">%</th>
                  </Show>
                </tr>
              </thead>
              <tbody>
                <tr className="font-semibold">
                  <td>Revenue</td>
                  <td className="text-right">
                    {sql`format.currency(total_revenue, 'USD')`}
                  </td>
                  <Show when={sql`comparison_enabled`}>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                  </Show>
                </tr>
                <tr>
                  <td className="pl-4">Cost of Goods Sold</td>
                  <td className="text-right">
                    ({sql`format.currency(total_cogs, 'USD')`})
                  </td>
                  <Show when={sql`comparison_enabled`}>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                  </Show>
                </tr>
                <tr className="border-t border-divider font-semibold">
                  <td>Gross Profit</td>
                  <td className="text-right">
                    {sql`format.currency(gross_profit, 'USD')`}
                  </td>
                  <Show when={sql`comparison_enabled`}>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                  </Show>
                </tr>
                <tr>
                  <td className="pl-4">Operating Expenses</td>
                  <td className="text-right">
                    ({sql`format.currency(total_opex, 'USD')`})
                  </td>
                  <Show when={sql`comparison_enabled`}>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                  </Show>
                </tr>
                <tr className="border-t-2 border-divider font-bold">
                  <td>Operating Income</td>
                  <td className="text-right">
                    <Show when={sql`operating_income >= 0`}>
                      <span className="text-success-600">
                        {sql`format.currency(operating_income, 'USD')`}
                      </span>
                    </Show>
                    <Show when={sql`operating_income < 0`}>
                      <span className="text-danger-600">
                        {sql`format.currency(operating_income, 'USD')`}
                      </span>
                    </Show>
                  </td>
                  <Show when={sql`comparison_enabled`}>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                    <td className="text-right">-</td>
                  </Show>
                </tr>
              </tbody>
            </Table>
          </Card>
        </Show>

        {/* Detailed View */}
        <Show when={sql`view_type = 'detailed'`}>
          <Card className="p-6">
            <Table>
              <thead>
                <tr>
                  <th className="text-left">Account</th>
                  <th className="text-right">Current Period</th>
                  <Show when={sql`comparison_enabled`}>
                    <th className="text-right">Comparison</th>
                    <th className="text-right">Variance</th>
                    <th className="text-right">%</th>
                  </Show>
                </tr>
              </thead>
              <tbody>
                <Each table="category_totals" recordName="category">
                  <tr className="bg-surface font-semibold">
                    <Show when={sql`comparison_enabled`}>
                      <td colSpan={5}>{sql`category.account_category`}</td>
                    </Show>
                    <Show when={sql`not comparison_enabled`}>
                      <td colSpan={2}>{sql`category.account_category`}</td>
                    </Show>
                  </tr>
                  <Each
                    table="pl_by_account"
                    recordName="account"
                    where={sql`account.account_category = category.account_category`}
                  >
                    <tr>
                      <td className="pl-4">{sql`account.account_name`}</td>
                      <td className="text-right">
                        <Show when={sql`account.account_type = 'revenue'`}>
                          {sql`format.currency(account.current_amount, 'USD')`}
                        </Show>
                        <Show when={sql`account.account_type = 'expense'`}>
                          ({sql`format.currency(account.current_amount, 'USD')`})
                        </Show>
                      </td>
                      <Show when={sql`comparison_enabled`}>
                        <td className="text-right">
                          <Show when={sql`account.account_type = 'revenue'`}>
                            {sql`format.currency(account.comparison_amount, 'USD')`}
                          </Show>
                          <Show when={sql`account.account_type = 'expense'`}>
                            ({sql`format.currency(account.comparison_amount, 'USD')`})
                          </Show>
                        </td>
                        <td className="text-right">
                          <Show when={sql`account.variance > 0`}>
                            <span className="text-success-600">
                              {sql`format.currency(account.variance, 'USD')`}
                            </span>
                          </Show>
                          <Show when={sql`account.variance < 0`}>
                            <span className="text-danger-600">
                              {sql`format.currency(account.variance, 'USD')`}
                            </span>
                          </Show>
                          <Show when={sql`account.variance = 0`}>-</Show>
                        </td>
                        <td className="text-right">
                          <Show when={sql`account.variance_pct != 0`}>
                            {sql`round(account.variance_pct, 1) || '%'`}
                          </Show>
                          <Show when={sql`account.variance_pct = 0`}>-</Show>
                        </td>
                      </Show>
                    </tr>
                  </Each>
                  <tr className="font-semibold border-t border-divider">
                    <td className="text-right">Subtotal</td>
                    <td className="text-right">
                      <Show when={sql`category.account_type = 'revenue'`}>
                        {sql`format.currency(category.category_current, 'USD')`}
                      </Show>
                      <Show when={sql`category.account_type = 'expense'`}>
                        ({sql`format.currency(category.category_current, 'USD')`})
                      </Show>
                    </td>
                    <Show when={sql`comparison_enabled`}>
                      <td className="text-right">
                        <Show when={sql`category.account_type = 'revenue'`}>
                          {sql`format.currency(category.category_comparison, 'USD')`}
                        </Show>
                        <Show when={sql`category.account_type = 'expense'`}>
                          ({sql`format.currency(category.category_comparison, 'USD')`})
                        </Show>
                      </td>
                      <td className="text-right">
                        {sql`format.currency(category.category_variance, 'USD')`}
                      </td>
                      <td className="text-right">-</td>
                    </Show>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Show>
      </div>
    </Data>
  );
}

export function PeriodCloseManager() {
  return (
    <Data
      procedure={(s) => {
        s.defTable(
          "open_periods",
          sql`
      select
        p.id,
        p.period_name,
        p.start_date,
        p.end_date,
        p.status,
        p.revenue_recognized,
        p.expenses_accrued,
        p.reconciliations_complete,
        p.adjusting_entries_posted,
        p.financial_statements_reviewed
      from db.gl_periods p
      where p.status in ('open', 'closing')
      order by p.start_date desc
    `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Period Close Manager</Typography>

        <Card className="p-4">
          <Typography level="title-md" className="mb-4">
            Open Periods
          </Typography>
          <Table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Checklist Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <Each table="open_periods" recordName="period">
                <tr>
                  <td>{sql`period.period_name`}</td>
                  <td>
                    {sql`format.date(period.start_date, '%Y-%m-%d')`} -{" "}
                    {sql`format.date(period.end_date, '%Y-%m-%d')`}
                  </td>
                  <td>
                    <Chip
                      size="sm"
                      variant="soft"
                      color="primary"
                    >
                      {sql`period.status`}
                    </Chip>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Show when={sql`period.revenue_recognized`}>
                        <MaterialIcon
                          icon="Check"
                          className="text-success-600 text-sm"
                        />
                      </Show>
                      <Show when={sql`not period.revenue_recognized`}>
                        <MaterialIcon
                          icon="Close"
                          className="text-danger-600 text-sm"
                        />
                      </Show>

                      <Show when={sql`period.expenses_accrued`}>
                        <MaterialIcon
                          icon="Check"
                          className="text-success-600 text-sm"
                        />
                      </Show>
                      <Show when={sql`not period.expenses_accrued`}>
                        <MaterialIcon
                          icon="Close"
                          className="text-danger-600 text-sm"
                        />
                      </Show>

                      <Show when={sql`period.reconciliations_complete`}>
                        <MaterialIcon
                          icon="Check"
                          className="text-success-600 text-sm"
                        />
                      </Show>
                      <Show when={sql`not period.reconciliations_complete`}>
                        <MaterialIcon
                          icon="Close"
                          className="text-danger-600 text-sm"
                        />
                      </Show>

                      <Show when={sql`period.adjusting_entries_posted`}>
                        <MaterialIcon
                          icon="Check"
                          className="text-success-600 text-sm"
                        />
                      </Show>
                      <Show when={sql`not period.adjusting_entries_posted`}>
                        <MaterialIcon
                          icon="Close"
                          className="text-danger-600 text-sm"
                        />
                      </Show>

                      <Show when={sql`period.financial_statements_reviewed`}>
                        <MaterialIcon
                          icon="Check"
                          className="text-success-600 text-sm"
                        />
                      </Show>
                      <Show
                        when={sql`not period.financial_statements_reviewed`}
                      >
                        <MaterialIcon
                          icon="Close"
                          className="text-danger-600 text-sm"
                        />
                      </Show>
                    </div>
                  </td>
                  <td>
                    <Button
                      variant="outlined"
                      size="sm"
                    >
                      Manage
                    </Button>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>
      </div>
    </Data>
  );
}
