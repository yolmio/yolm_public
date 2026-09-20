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
import { Input } from "components/input";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Divider } from "components/divider";
import { Checkbox } from "components/checkbox";
import { EachSelect } from "components/each_select";

export function PLByJurisdiction() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "selected_period_start",
          sql`date_trunc('month', current_date())::date`,
        );
        s.defScalar("selected_period_end", sql`last_day(current_date())::date`);
        s.defScalar("show_percentages", sql.true);
        s.defScalar("show_variances", sql.true);
        s.defScalar("selected_jurisdiction_id", sql.null);

        // Get P&L by jurisdiction
        s.defTable(
          "pl_by_jurisdiction",
          sql`
      with period_revenue as (
        select
          j.id as jurisdiction_id,
          j.name as jurisdiction_name,
          coalesce(sum(o.client_cost), 0) as revenue
        from db.jurisdictions j
        left join db.orders o on j.id = o.jurisdiction_id
          and o.status = 'invoiced'
          and o.completed_at between ui.selected_period_start and ui.selected_period_end
        group by j.id, j.name
      ),
      period_costs as (
        select
          j.id as jurisdiction_id,
          coalesce(sum(o.researcher_cost), 0) as direct_costs,
          coalesce(sum(oe.amount_paid_researcher), 0) as expense_costs
        from db.jurisdictions j
        left join db.orders o on j.id = o.jurisdiction_id
          and o.status in ('completed', 'delivered', 'invoiced')
          and o.completed_at between ui.selected_period_start and ui.selected_period_end
        left join db.order_expenses oe on o.id = oe.order_id
        group by j.id
      ),
      allocated_overhead as (
        select
          jl.jurisdiction_id,
          sum(jl.debit - jl.credit) as overhead_amount
        from db.journal_lines jl
        join db.journal_entries je on jl.journal_id = je.id
        where je.entry_type in ('expense', 'overhead_allocation')
          and je.entry_date between ui.selected_period_start and ui.selected_period_end
          and jl.jurisdiction_id is not null
          and jl.account in ('salaries', 'rent', 'utilities', 'insurance', 'marketing', 'technology')
        group by jl.jurisdiction_id
      )
      select
        r.jurisdiction_id,
        r.jurisdiction_name,
        r.revenue,
        c.direct_costs,
        c.expense_costs,
        coalesce(ao.overhead_amount, 0) as allocated_overhead,
        r.revenue - c.direct_costs - c.expense_costs as gross_profit,
        (r.revenue - c.direct_costs - c.expense_costs)::numeric / nullif(r.revenue, 0) * 100 as gross_margin_pct,
        r.revenue - c.direct_costs - c.expense_costs - coalesce(ao.overhead_amount, 0) as net_profit,
        (r.revenue - c.direct_costs - c.expense_costs - coalesce(ao.overhead_amount, 0))::numeric / nullif(r.revenue, 0) * 100 as net_margin_pct,
        count(distinct o.id) as order_count
      from period_revenue r
      left join period_costs c on r.jurisdiction_id = c.jurisdiction_id
      left join allocated_overhead ao on r.jurisdiction_id = ao.jurisdiction_id
      left join db.orders o on r.jurisdiction_id = o.jurisdiction_id
        and o.completed_at between ui.selected_period_start and ui.selected_period_end
      where (ui.selected_jurisdiction_id is null or r.jurisdiction_id = ui.selected_jurisdiction_id)
      group by r.jurisdiction_id, r.jurisdiction_name, r.revenue, c.direct_costs,
               c.expense_costs, ao.overhead_amount
      order by r.revenue desc
    `,
        );

        // Calculate totals
        s.defScalar(
          "total_revenue",
          sql`(select coalesce(sum(revenue), 0) from pl_by_jurisdiction)`,
        );
        s.defScalar(
          "total_direct_costs",
          sql`(select coalesce(sum(direct_costs), 0) from pl_by_jurisdiction)`,
        );
        s.defScalar(
          "total_gross_profit",
          sql`(select coalesce(sum(gross_profit), 0) from pl_by_jurisdiction)`,
        );
        s.defScalar(
          "total_net_profit",
          sql`(select coalesce(sum(net_profit), 0) from pl_by_jurisdiction)`,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">P&L by Jurisdiction</Typography>
          <Button
            variant="outlined"
            startDecorator={<MaterialIcon icon="Download" />}
          >
            Export Report
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <FormControl>
              <FormLabel>Period Start</FormLabel>
              <Input
                type="date"
                value={sql`selected_period_start`}
                onInput={(s) =>
                  s.setScalar("selected_period_start", sql`target_value`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Period End</FormLabel>
              <Input
                type="date"
                value={sql`selected_period_end`}
                onInput={(s) =>
                  s.setScalar("selected_period_end", sql`target_value`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Jurisdiction</FormLabel>
              <Data
                procedure={(s) => {
                  s.defTable(
                    "jurisdictions",
                    sql`select id, name from db.jurisdictions order by name`,
                  );
                }}
              >
                <EachSelect
                  table="jurisdictions"
                  value={sql`selected_jurisdiction_id`}
                  onChange={(s, recordId) =>
                    s.setScalar("selected_jurisdiction_id", recordId)}
                  placeholder="All Jurisdictions"
                  size="md"
                  className="bg-neutral-100 "
                  optionLabel="name"
                  optionValue="id"
                />
              </Data>
            </FormControl>
            <div className="flex gap-2 items-end">
              <Checkbox
                checked={sql`show_percentages`}
                onInput={(s) =>
                  s.setScalar("show_percentages", sql`target_checked`)}
              />
              <FormLabel>Show %</FormLabel>
              <Checkbox
                checked={sql`show_variances`}
                onInput={(s) =>
                  s.setScalar("show_variances", sql`target_checked`)}
              />
              <FormLabel>Variances</FormLabel>
            </div>
          </div>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Total Revenue
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(total_revenue, 'USD')`}
            </Typography>
          </Card>
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Total Direct Costs
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(total_direct_costs, 'USD')`}
            </Typography>
          </Card>
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Gross Profit
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(total_gross_profit, 'USD')`}
            </Typography>
          </Card>
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Net Profit
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(total_net_profit, 'USD')`}
            </Typography>
          </Card>
        </div>

        {/* Detailed Table */}
        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Direct Costs</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Overhead</th>
                <th className="text-right">Gross Profit</th>
                <Show when={sql`show_percentages`}>
                  <th className="text-right">GP %</th>
                </Show>
                <th className="text-right">Net Profit</th>
                <Show when={sql`show_percentages`}>
                  <th className="text-right">NP %</th>
                </Show>
                <th className="text-right">Orders</th>
              </tr>
            </thead>
            <tbody>
              <Each table="pl_by_jurisdiction" recordName="pl">
                <tr>
                  <td>{sql`pl.jurisdiction_name`}</td>
                  <td className="text-right">
                    {sql`format.currency(pl.revenue, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.direct_costs, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.expense_costs, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.allocated_overhead, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.gross_profit, 'USD')`}
                  </td>
                  <Show when={sql`show_percentages`}>
                    <td className="text-right">
                      {sql`round(pl.gross_margin_pct, 1) || '%'`}
                    </td>
                  </Show>
                  <td className="text-right">
                    <Show when={sql`pl.net_profit >= 0`}>
                      <span className="text-success-700">
                        {sql`format.currency(pl.net_profit, 'USD')`}
                      </span>
                    </Show>
                    <Show when={sql`pl.net_profit < 0`}>
                      <span className="text-danger-600">
                        {sql`format.currency(pl.net_profit, 'USD')`}
                      </span>
                    </Show>
                  </td>
                  <Show when={sql`show_percentages`}>
                    <td className="text-right">
                      {sql`round(pl.net_margin_pct, 1) || '%'`}
                    </td>
                  </Show>
                  <td className="text-right">{sql`pl.order_count`}</td>
                </tr>
              </Each>
            </tbody>
            <tfoot className="font-bold border-t-2 border-divider">
              <tr>
                <td>Total</td>
                <td className="text-right">
                  {sql`format.currency(total_revenue, 'USD')`}
                </td>
                <td className="text-right">
                  {sql`format.currency(total_direct_costs, 'USD')`}
                </td>
                <td className="text-right">
                  {sql`format.currency((select sum(expense_costs) from pl_by_jurisdiction), 'USD')`}
                </td>
                <td className="text-right">
                  {sql`format.currency((select sum(allocated_overhead) from pl_by_jurisdiction), 'USD')`}
                </td>
                <td className="text-right">
                  {sql`format.currency(total_gross_profit, 'USD')`}
                </td>
                <Show when={sql`show_percentages`}>
                  <td className="text-right">
                    {sql`round(total_gross_profit::numeric / nullif(total_revenue, 0) * 100, 1) || '%'`}
                  </td>
                </Show>
                <td className="text-right">
                  {sql`format.currency(total_net_profit, 'USD')`}
                </td>
                <Show when={sql`show_percentages`}>
                  <td className="text-right">
                    {sql`round(total_net_profit::numeric / nullif(total_revenue, 0) * 100, 1) || '%'`}
                  </td>
                </Show>
                <td className="text-right">
                  {sql`(select sum(order_count) from pl_by_jurisdiction)`}
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      </div>
    </Data>
  );
}

export function PLByResearcher() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "selected_period_start",
          sql`date_trunc('month', current_date())::date`,
        );
        s.defScalar("selected_period_end", sql`last_day(current_date())::date`);
        s.defScalar("selected_researcher_id", sql.null);

        // Get P&L by researcher
        s.defTable(
          "pl_by_researcher",
          sql`
      with researcher_activity as (
        select
          r.id as researcher_id,
          r.name as researcher_name,
          r.code as researcher_code,
          count(distinct o.id) as order_count,
          coalesce(sum(o.client_cost), 0) as revenue_generated,
          coalesce(sum(o.researcher_cost), 0) as cost_to_company,
          coalesce(sum(oe.amount_paid_researcher), 0) as expenses_paid,
          count(distinct o.jurisdiction_id) as jurisdictions_served,
          avg(extract(epoch from (o.completed_at - o.assigned_at))/3600)::numeric as avg_turnaround_hours
        from db.researchers r
        left join db.orders o on r.id = o.researcher_id
          and o.status in ('completed', 'delivered', 'invoiced')
          and o.completed_at between ui.selected_period_start and ui.selected_period_end
        left join db.order_expenses oe on o.id = oe.order_id
        where (ui.selected_researcher_id is null or r.id = ui.selected_researcher_id)
        group by r.id, r.name, r.code
      ),
      researcher_bills as (
        select
          r.id as researcher_id,
          coalesce(sum(b.total_amount), 0) as total_billed,
          coalesce(sum(case when b.status = 'paid' then b.total_amount else 0 end), 0) as total_paid
        from db.researchers r
        left join db.ap_bills b on r.id = b.researcher_id
          and b.bill_date between ui.selected_period_start and ui.selected_period_end
        group by r.id
      )
      select
        ra.*,
        rb.total_billed,
        rb.total_paid,
        ra.revenue_generated - ra.cost_to_company - ra.expenses_paid as gross_profit,
        case
          when ra.revenue_generated > 0
          then ((ra.revenue_generated - ra.cost_to_company - ra.expenses_paid)::numeric / ra.revenue_generated * 100)
          else 0
        end as profit_margin_pct,
        case
          when ra.order_count > 0
          then (ra.revenue_generated - ra.cost_to_company)::numeric / ra.order_count
          else 0
        end as avg_profit_per_order
      from researcher_activity ra
      left join researcher_bills rb on ra.researcher_id = rb.researcher_id
      order by ra.revenue_generated desc
    `,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">P&L by Researcher</Typography>
          <Button
            variant="outlined"
            startDecorator={<MaterialIcon icon="Download" />}
          >
            Export Report
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormControl>
              <FormLabel>Period Start</FormLabel>
              <Input
                type="date"
                value={sql`selected_period_start`}
                onInput={(s) =>
                  s.setScalar("selected_period_start", sql`target_value`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Period End</FormLabel>
              <Input
                type="date"
                value={sql`selected_period_end`}
                onInput={(s) =>
                  s.setScalar("selected_period_end", sql`target_value`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Researcher</FormLabel>
              <Data
                procedure={(s) => {
                  s.defTable(
                    "researchers",
                    sql`select id, name from db.researchers order by name`,
                  );
                }}
              >
                <EachSelect
                  table="researchers"
                  value={sql`selected_researcher_id`}
                  onChange={(s, recordId) =>
                    s.setScalar("selected_researcher_id", recordId)}
                  placeholder="All Researchers"
                  size="md"
                  className="bg-neutral-100 "
                  optionLabel="name"
                  optionValue="id"
                />
              </Data>
            </FormControl>
          </div>
        </Card>

        {/* Researcher Performance Table */}
        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Researcher</th>
                <th className="text-right">Orders</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Gross Profit</th>
                <th className="text-right">Margin %</th>
                <th className="text-right">Avg $/Order</th>
                <th className="text-right">Avg TAT (hrs)</th>
              </tr>
            </thead>
            <tbody>
              <Each table="pl_by_researcher" recordName="pl">
                <tr>
                  <td>
                    <div>
                      <Typography level="body-md">
                        {sql`pl.researcher_name`}
                      </Typography>
                      <Typography level="body-sm" className="text-secondary">
                        {sql`pl.researcher_code`}
                      </Typography>
                    </div>
                  </td>
                  <td className="text-right">{sql`pl.order_count`}</td>
                  <td className="text-right">
                    {sql`format.currency(pl.revenue_generated, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.cost_to_company, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.expenses_paid, 'USD')`}
                  </td>
                  <td className="text-right">
                    <Show when={sql`pl.gross_profit >= 0`}>
                      <span className="text-success-700">
                        {sql`format.currency(pl.gross_profit, 'USD')`}
                      </span>
                    </Show>
                    <Show when={sql`pl.gross_profit < 0`}>
                      <span className="text-danger-600">
                        {sql`format.currency(pl.gross_profit, 'USD')`}
                      </span>
                    </Show>
                  </td>
                  <td className="text-right">
                    <Show when={sql`pl.profit_margin_pct >= 30`}>
                      <Chip size="sm" variant="soft" color="success">
                        {sql`round(pl.profit_margin_pct, 1) || '%'`}
                      </Chip>
                    </Show>
                    <Show
                      when={sql`pl.profit_margin_pct >= 15 and pl.profit_margin_pct < 30`}
                    >
                      <Chip size="sm" variant="soft" color="warning">
                        {sql`round(pl.profit_margin_pct, 1) || '%'`}
                      </Chip>
                    </Show>
                    <Show when={sql`pl.profit_margin_pct < 15`}>
                      <Chip size="sm" variant="soft" color="danger">
                        {sql`round(pl.profit_margin_pct, 1) || '%'`}
                      </Chip>
                    </Show>
                  </td>
                  <td className="text-right">
                    {sql`format.currency(pl.avg_profit_per_order, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`round(pl.avg_turnaround_hours, 1)`}
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

export function MarginAnalysisTools() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("analysis_type", sql.lit`by_client_type`);
        s.defScalar(
          "selected_period_start",
          sql`date_trunc('month', current_date())::date`,
        );
        s.defScalar("selected_period_end", sql`last_day(current_date())::date`);
        s.defScalar("margin_threshold", sql`20`);

        // Margin analysis by client type
        s.defTable(
          "margin_by_client_type",
          sql`
      select
        c.type as client_type,
        count(distinct o.id) as order_count,
        sum(o.client_cost) as total_revenue,
        sum(o.researcher_cost) as total_cost,
        sum(oe.amount_incurred) as total_expenses,
        sum(o.client_cost) - sum(o.researcher_cost) - coalesce(sum(oe.amount_incurred), 0) as gross_profit,
        case
          when sum(o.client_cost) > 0
          then ((sum(o.client_cost) - sum(o.researcher_cost) - coalesce(sum(oe.amount_incurred), 0))::numeric / sum(o.client_cost) * 100)
          else 0
        end as margin_pct,
        avg(o.client_cost) as avg_order_value
      from db.clients c
      join db.orders o on c.id = o.client_id
        and o.status in ('completed', 'delivered', 'invoiced')
        and o.completed_at between ui.selected_period_start and ui.selected_period_end
      left join db.order_expenses oe on o.id = oe.order_id
      group by c.type
      order by total_revenue desc
    `,
        );

        // Low margin orders
        s.defTable(
          "low_margin_orders",
          sql`
      with order_margins as (
        select
          o.id,
          o.order_number,
          c.name as client_name,
          j.name as jurisdiction_name,
          o.search_type,
          o.client_cost as revenue,
          o.researcher_cost + coalesce(sum(oe.amount_incurred), 0) as total_cost,
          o.client_cost - o.researcher_cost - coalesce(sum(oe.amount_incurred), 0) as profit,
          case
            when o.client_cost > 0
            then ((o.client_cost - o.researcher_cost - coalesce(sum(oe.amount_incurred), 0))::numeric / o.client_cost * 100)
            else 0
          end as margin_pct
        from db.orders o
        join db.clients c on o.client_id = c.id
        join db.jurisdictions j on o.jurisdiction_id = j.id
        left join db.order_expenses oe on o.id = oe.order_id
        where o.status in ('completed', 'delivered', 'invoiced')
          and o.completed_at between ui.selected_period_start and ui.selected_period_end
        group by o.id, o.order_number, c.name, j.name, o.search_type, o.client_cost, o.researcher_cost
      )
      select *
      from order_margins
      where margin_pct < ui.margin_threshold
      order by margin_pct asc
      limit 50
    `,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <Typography level="title-lg">Margin Analysis Tools</Typography>

        {/* Filters */}
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <FormControl>
              <FormLabel>Analysis Type</FormLabel>
              <Select
                value={sql`analysis_type`}
                onChange={(s) =>
                  s.setScalar("analysis_type", sql`target_value`)}
              >
                <Select.Option value="by_client_type">
                  By Client Type
                </Select.Option>
                <Select.Option value="by_jurisdiction">
                  By Jurisdiction
                </Select.Option>
                <Select.Option value="by_search_type">
                  By Search Type
                </Select.Option>
                <Select.Option value="low_margin">
                  Low Margin Orders
                </Select.Option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Period Start</FormLabel>
              <Input
                type="date"
                value={sql`selected_period_start`}
                onInput={(s) =>
                  s.setScalar("selected_period_start", sql`target_value`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Period End</FormLabel>
              <Input
                type="date"
                value={sql`selected_period_end`}
                onInput={(s) =>
                  s.setScalar("selected_period_end", sql`target_value`)}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Low Margin Threshold %</FormLabel>
              <Input
                type="number"
                value={sql`margin_threshold`}
                onInput={(s) =>
                  s.setScalar("margin_threshold", sql`target_value`)}
              />
            </FormControl>
          </div>
        </Card>

        <Show when={sql`analysis_type = 'by_client_type'`}>
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Margin Analysis by Client Type
            </Typography>
            <Table>
              <thead>
                <tr>
                  <th>Client Type</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Gross Profit</th>
                  <th className="text-right">Margin %</th>
                  <th className="text-right">Avg Order Value</th>
                </tr>
              </thead>
              <tbody>
                <Each table="margin_by_client_type" recordName="margin">
                  <tr>
                    <td className="uppercase">{sql`margin.client_type`}</td>
                    <td className="text-right">{sql`margin.order_count`}</td>
                    <td className="text-right">
                      {sql`format.currency(margin.total_revenue, 'USD')`}
                    </td>
                    <td className="text-right">
                      {sql`format.currency(margin.total_cost, 'USD')`}
                    </td>
                    <td className="text-right">
                      {sql`format.currency(margin.total_expenses, 'USD')`}
                    </td>
                    <td className="text-right">
                      {sql`format.currency(margin.gross_profit, 'USD')`}
                    </td>
                    <td className="text-right">
                      <Show when={sql`margin.margin_pct >= 30`}>
                        <Chip size="sm" variant="soft" color="success">
                          {sql`round(margin.margin_pct, 1) || '%'`}
                        </Chip>
                      </Show>
                      <Show
                        when={sql`margin.margin_pct >= 20 and margin.margin_pct < 30`}
                      >
                        <Chip size="sm" variant="soft" color="warning">
                          {sql`round(margin.margin_pct, 1) || '%'`}
                        </Chip>
                      </Show>
                      <Show when={sql`margin.margin_pct < 20`}>
                        <Chip size="sm" variant="soft" color="danger">
                          {sql`round(margin.margin_pct, 1) || '%'`}
                        </Chip>
                      </Show>
                    </td>
                    <td className="text-right">
                      {sql`format.currency(margin.avg_order_value, 'USD')`}
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Show>

        <Show when={sql`analysis_type = 'low_margin'`}>
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Low Margin Orders (Below {sql`margin_threshold`}%)
            </Typography>
            <Table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Client</th>
                  <th>Jurisdiction</th>
                  <th>Type</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Profit</th>
                  <th className="text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                <Each table="low_margin_orders" recordName="order">
                  <tr>
                    <td>{sql`order.order_number`}</td>
                    <td>{sql`order.client_name`}</td>
                    <td>{sql`order.jurisdiction_name`}</td>
                    <td>{sql`order.search_type`}</td>
                    <td className="text-right">
                      {sql`format.currency(order.revenue, 'USD')`}
                    </td>
                    <td className="text-right">
                      {sql`format.currency(order.total_cost, 'USD')`}
                    </td>
                    <td className="text-right">
                      <span className="text-danger-600">
                        {sql`format.currency(order.profit, 'USD')`}
                      </span>
                    </td>
                    <td className="text-right">
                      <Chip size="sm" variant="soft" color="danger">
                        {sql`round(order.margin_pct, 1) || '%'`}
                      </Chip>
                    </td>
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

export function BudgetComparison() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "budget_period",
          sql`date_trunc('month', current_date())::date`,
        );
        s.defScalar("create_budget_modal", sql.false);
        s.defScalar("selected_account", sql.null);
        s.defScalar("budget_amount", sql`0`);

        // Get budget vs actual
        s.defTable(
          "budget_comparison",
          sql`
      with account_actuals as (
        select
          jl.account,
          sum(jl.debit - jl.credit) as actual_amount
        from db.journal_lines jl
        join db.journal_entries je on jl.journal_id = je.id
        where je.entry_date >= ui.budget_period
          and je.entry_date < ui.budget_period + interval '1 month'
          and je.status = 'posted'
        group by jl.account
      ),
      account_budgets as (
        select
          account,
          budget_amount
        from db.budget_entries
        where period_start = ui.budget_period
      )
      select
        coa.account_code as account,
        coa.account_name,
        coa.account_type,
        coalesce(ab.budget_amount, 0) as budget,
        coalesce(aa.actual_amount, 0) as actual,
        coalesce(ab.budget_amount, 0) - coalesce(aa.actual_amount, 0) as variance,
        case
          when ab.budget_amount > 0
          then (aa.actual_amount::numeric / ab.budget_amount * 100)
          else 0
        end as percent_used
      from db.chart_of_accounts coa
      left join account_budgets ab on coa.account_code = ab.account
      left join account_actuals aa on coa.account_code = aa.account
      where coa.is_active
        and (ab.budget_amount is not null or aa.actual_amount is not null)
      order by coa.sort_order
    `,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Budget Comparison</Typography>
          <Button
            variant="solid"
            color="primary"
            onClick={(s) => s.setScalar("create_budget_modal", sql.true)}
          >
            Create Budget
          </Button>
        </div>

        {/* Period Selection */}
        <Card className="p-4">
          <FormControl>
            <FormLabel>Budget Period</FormLabel>
            <Input
              type="month"
              value={sql`format.date(budget_period, 'yyyy-MM')`}
              onChange={(s) =>
                s.setScalar(
                  "budget_period",
                  sql`date_trunc('month', target_value::date)`,
                )}
            />
          </FormControl>
        </Card>

        {/* Budget vs Actual Table */}
        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Account</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Actual</th>
                <th className="text-right">Variance</th>
                <th className="text-right">% Used</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <Each table="budget_comparison" recordName="budget">
                <tr>
                  <td>
                    <div>
                      <Typography level="body-md">
                        {sql`budget.account_name`}
                      </Typography>
                      <Typography level="body-sm" className="text-secondary">
                        {sql`budget.account`}
                      </Typography>
                    </div>
                  </td>
                  <td className="text-right">
                    {sql`format.currency(budget.budget, 'USD')`}
                  </td>
                  <td className="text-right">
                    {sql`format.currency(budget.actual, 'USD')`}
                  </td>
                  <td className="text-right">
                    <Show when={sql`budget.variance >= 0`}>
                      <span className="text-success-700">
                        {sql`format.currency(budget.variance, 'USD')`}
                      </span>
                    </Show>
                    <Show when={sql`budget.variance < 0`}>
                      <span className="text-danger-600">
                        {sql`format.currency(budget.variance, 'USD')`}
                      </span>
                    </Show>
                  </td>
                  <td className="text-right">
                    {sql`round(budget.percent_used, 1) || '%'`}
                  </td>
                  <td>
                    <Show when={sql`budget.percent_used <= 90`}>
                      <Chip size="sm" variant="soft" color="success">
                        On Track
                      </Chip>
                    </Show>
                    <Show
                      when={sql`budget.percent_used > 90 and budget.percent_used <= 100`}
                    >
                      <Chip size="sm" variant="soft" color="warning">
                        Near Limit
                      </Chip>
                    </Show>
                    <Show when={sql`budget.percent_used > 100`}>
                      <Chip size="sm" variant="soft" color="danger">
                        Over Budget
                      </Chip>
                    </Show>
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

export function TrialBalanceReport() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("balance_date", sql`current_date()`);
        s.defScalar("show_zero_balances", sql.false);
        s.defScalar("group_by_type", sql.true);

        // Get trial balance
        s.defTable(
          "trial_balance",
          sql`
      with account_balances as (
        select
          jl.account,
          sum(jl.debit) as total_debits,
          sum(jl.credit) as total_credits,
          sum(jl.debit - jl.credit) as net_balance
        from db.journal_lines jl
        join db.journal_entries je on jl.journal_id = je.id
        where je.entry_date <= ui.balance_date
          and je.status = 'posted'
        group by jl.account
      )
      select
        coa.account_code,
        coa.account_name,
        coa.account_type,
        coa.account_category,
        coa.normal_balance,
        coalesce(ab.total_debits, 0) as debit_balance,
        coalesce(ab.total_credits, 0) as credit_balance,
        case
          when coa.normal_balance = 'debit' then coalesce(ab.net_balance, 0)
          else 0
        end as debit_total,
        case
          when coa.normal_balance = 'credit' then abs(coalesce(ab.net_balance, 0))
          else 0
        end as credit_total
      from db.chart_of_accounts coa
      left join account_balances ab on coa.account_code = ab.account
      where coa.is_active
        and (ui.show_zero_balances or ab.net_balance != 0 or ab.net_balance is not null)
      order by coa.account_type, coa.sort_order
    `,
        );

        // Calculate totals
        s.defScalar(
          "total_debits",
          sql`(select sum(debit_total) from trial_balance)`,
        );
        s.defScalar(
          "total_credits",
          sql`(select sum(credit_total) from trial_balance)`,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Trial Balance Report</Typography>
          <Button
            variant="outlined"
            startDecorator={<MaterialIcon icon="Download" />}
          >
            Export Report
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex gap-4 items-end">
            <FormControl>
              <FormLabel>As of Date</FormLabel>
              <Input
                type="date"
                value={sql`balance_date`}
                onInput={(s) => s.setScalar("balance_date", sql`target_value`)}
              />
            </FormControl>
            <Checkbox
              checked={sql`show_zero_balances`}
              onInput={(s) =>
                s.setScalar("show_zero_balances", sql`target_checked`)}
            />
            <FormLabel>Show Zero Balances</FormLabel>
            <Checkbox
              checked={sql`group_by_type`}
              onInput={(s) => s.setScalar("group_by_type", sql`target_checked`)}
            />
            <FormLabel>Group by Type</FormLabel>
          </div>
        </Card>

        {/* Balance Check */}
        <Card className="p-4">
          <div className="flex justify-between items-center">
            <Typography level="body-md">Trial Balance Status:</Typography>
            <Show when={sql`abs(total_debits - total_credits) < 0.01`}>
              <Chip variant="soft" color="success" size="lg">
                BALANCED
              </Chip>
            </Show>
            <Show when={sql`abs(total_debits - total_credits) >= 0.01`}>
              <Chip variant="soft" color="danger" size="lg">
                OUT OF BALANCE:{" "}
                {sql`format.currency(abs(total_debits - total_credits), 'USD')`}
              </Chip>
            </Show>
          </div>
        </Card>

        {/* Trial Balance Table */}
        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Account Code</th>
                <th>Account Name</th>
                <th>Type</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              <Each table="trial_balance" recordName="tb">
                <tr>
                  <td>{sql`tb.account_code`}</td>
                  <td>{sql`tb.account_name`}</td>
                  <td>{sql`tb.account_type`}</td>
                  <td className="text-right">
                    <Show when={sql`tb.debit_total > 0`}>
                      {sql`format.currency(tb.debit_total, 'USD')`}
                    </Show>
                  </td>
                  <td className="text-right">
                    <Show when={sql`tb.credit_total > 0`}>
                      {sql`format.currency(tb.credit_total, 'USD')`}
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
            <tfoot className="font-bold border-t-2 border-divider">
              <tr>
                <td colSpan={3}>Total</td>
                <td className="text-right">
                  {sql`format.currency(total_debits, 'USD')`}
                </td>
                <td className="text-right">
                  {sql`format.currency(total_credits, 'USD')`}
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      </div>
    </Data>
  );
}

export function BalanceSheetReport() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("balance_date", sql`current_date()`);
        s.defScalar(
          "comparison_date",
          sql`date_trunc('month', current_date() - interval '1 month')::date`,
        );
        s.defScalar("show_comparison", sql.false);

        // Assets
        s.defTable(
          "balance_sheet_assets",
          sql`
      with current_balances as (
        select
          coa.account_code,
          coa.account_name,
          coa.account_category,
          sum(jl.debit - jl.credit) as balance
        from db.chart_of_accounts coa
        left join db.journal_lines jl on coa.account_code = jl.account
        left join db.journal_entries je on jl.journal_id = je.id
        where coa.account_type = 'asset'
          and coa.is_active
          and je.entry_date <= ui.balance_date
          and je.status = 'posted'
        group by coa.account_code, coa.account_name, coa.account_category
      )
      select
        account_category,
        sum(balance) as category_total,
        json_agg(
          json_build_object(
            'account_code', account_code,
            'account_name', account_name,
            'balance', balance
          ) order by account_code
        ) as accounts
      from current_balances
      where balance != 0
      group by account_category
      order by account_category
    `,
        );

        // Liabilities
        s.defTable(
          "balance_sheet_liabilities",
          sql`
      with current_balances as (
        select
          coa.account_code,
          coa.account_name,
          coa.account_category,
          sum(jl.credit - jl.debit) as balance
        from db.chart_of_accounts coa
        left join db.journal_lines jl on coa.account_code = jl.account
        left join db.journal_entries je on jl.journal_id = je.id
        where coa.account_type = 'liability'
          and coa.is_active
          and je.entry_date <= ui.balance_date
          and je.status = 'posted'
        group by coa.account_code, coa.account_name, coa.account_category
      )
      select
        account_category,
        sum(balance) as category_total,
        json_agg(
          json_build_object(
            'account_code', account_code,
            'account_name', account_name,
            'balance', balance
          ) order by account_code
        ) as accounts
      from current_balances
      where balance != 0
      group by account_category
      order by account_category
    `,
        );

        // Equity
        s.defTable(
          "balance_sheet_equity",
          sql`
      with current_balances as (
        select
          coa.account_code,
          coa.account_name,
          coa.account_category,
          sum(jl.credit - jl.debit) as balance
        from db.chart_of_accounts coa
        left join db.journal_lines jl on coa.account_code = jl.account
        left join db.journal_entries je on jl.journal_id = je.id
        where coa.account_type = 'equity'
          and coa.is_active
          and je.entry_date <= ui.balance_date
          and je.status = 'posted'
        group by coa.account_code, coa.account_name, coa.account_category
      ),
      net_income as (
        select
          'net_income' as account_code,
          'Net Income' as account_name,
          'retained_earnings' as account_category,
          sum(
            case
              when coa.account_type = 'revenue' then jl.credit - jl.debit
              when coa.account_type = 'expense' then jl.debit - jl.credit
              else 0
            end
          ) as balance
        from db.journal_lines jl
        join db.journal_entries je on jl.journal_id = je.id
        join db.chart_of_accounts coa on jl.account = coa.account_code
        where coa.account_type in ('revenue', 'expense')
          and je.entry_date <= ui.balance_date
          and je.status = 'posted'
      )
      select
        account_category,
        sum(balance) as category_total,
        json_agg(
          json_build_object(
            'account_code', account_code,
            'account_name', account_name,
            'balance', balance
          ) order by account_code
        ) as accounts
      from (
        select * from current_balances
        union all
        select * from net_income
      ) all_equity
      where balance != 0
      group by account_category
      order by account_category
    `,
        );

        // Calculate totals
        s.defScalar(
          "total_assets",
          sql`(select coalesce(sum(category_total), 0) from balance_sheet_assets)`,
        );
        s.defScalar(
          "total_liabilities",
          sql`(select coalesce(sum(category_total), 0) from balance_sheet_liabilities)`,
        );
        s.defScalar(
          "total_equity",
          sql`(select coalesce(sum(category_total), 0) from balance_sheet_equity)`,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Balance Sheet</Typography>
          <Button
            variant="outlined"
            startDecorator={<MaterialIcon icon="Download" />}
          >
            Export Report
          </Button>
        </div>

        {/* Date Selection */}
        <Card className="p-4">
          <div className="flex gap-4 items-end">
            <FormControl>
              <FormLabel>As of Date</FormLabel>
              <Input
                type="date"
                value={sql`balance_date`}
                onInput={(s) => s.setScalar("balance_date", sql`target_value`)}
              />
            </FormControl>
            <Checkbox
              checked={sql`show_comparison`}
              onInput={(s) =>
                s.setScalar("show_comparison", sql`target_checked`)}
            />
            <FormLabel>Show Comparison</FormLabel>
            <Show when={sql`show_comparison`}>
              <FormControl>
                <FormLabel>Compare to</FormLabel>
                <Input
                  type="date"
                  value={sql`comparison_date`}
                  onInput={(s) =>
                    s.setScalar("comparison_date", sql`target_value`)}
                />
              </FormControl>
            </Show>
          </div>
        </Card>

        {/* Balance Sheet Equation Check */}
        <Card className="p-4">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Typography level="body-sm" className="text-secondary">
                Total Assets
              </Typography>
              <Typography level="title-lg">
                {sql`format.currency(total_assets, 'USD')`}
              </Typography>
            </div>
            <div>
              <Typography level="body-sm" className="text-secondary">
                Total Liabilities
              </Typography>
              <Typography level="title-lg">
                {sql`format.currency(total_liabilities, 'USD')`}
              </Typography>
            </div>
            <div>
              <Typography level="body-sm" className="text-secondary">
                Total Equity
              </Typography>
              <Typography level="title-lg">
                {sql`format.currency(total_equity, 'USD')`}
              </Typography>
            </div>
            <div>
              <Typography level="body-sm" className="text-secondary">
                Balance Check
              </Typography>
              <Show
                when={sql`abs(total_assets - (total_liabilities + total_equity)) < 0.01`}
              >
                <Chip variant="soft" color="success">BALANCED</Chip>
              </Show>
              <Show
                when={sql`abs(total_assets - (total_liabilities + total_equity)) >= 0.01`}
              >
                <Chip variant="soft" color="danger">OUT OF BALANCE</Chip>
              </Show>
            </div>
          </div>
        </Card>

        {/* Assets Section */}
        <Card className="p-4">
          <Typography level="title-md" className="mb-4">ASSETS</Typography>
          <Each table="balance_sheet_assets" recordName="category">
            <div className="mb-4">
              <Typography level="body-md" className="font-semibold mb-2">
                {sql`category.account_category`}
              </Typography>
              <Table size="sm">
                <tbody>
                  <Data
                    procedure={(s) => {
                      s.defTable(
                        "category_accounts",
                        sql`select * from json_to_recordset(${sql`category.accounts`}::json)
                          as x(account_code text, account_name text, balance numeric)`,
                      );
                    }}
                  >
                    <Each table="category_accounts" recordName="account">
                      <tr>
                        <td className="pl-4">{sql`account.account_name`}</td>
                        <td className="text-right">
                          {sql`format.currency(account.balance, 'USD')`}
                        </td>
                      </tr>
                    </Each>
                  </Data>
                  <tr className="font-semibold border-t border-divider">
                    <td>Total {sql`category.account_category`}</td>
                    <td className="text-right">
                      {sql`format.currency(category.category_total, 'USD')`}
                    </td>
                  </tr>
                </tbody>
              </Table>
            </div>
          </Each>
          <Divider />
          <div className="flex justify-between mt-4 font-bold">
            <Typography level="body-lg">TOTAL ASSETS</Typography>
            <Typography level="body-lg">
              {sql`format.currency(total_assets, 'USD')`}
            </Typography>
          </div>
        </Card>

        {/* Liabilities Section */}
        <Card className="p-4">
          <Typography level="title-md" className="mb-4">LIABILITIES</Typography>
          <Each table="balance_sheet_liabilities" recordName="category">
            <div className="mb-4">
              <Typography level="body-md" className="font-semibold mb-2">
                {sql`category.account_category`}
              </Typography>
              <Table size="sm">
                <tbody>
                  <Data
                    procedure={(s) => {
                      s.defTable(
                        "category_accounts",
                        sql`select * from json_to_recordset(${sql`category.accounts`}::json)
                          as x(account_code text, account_name text, balance numeric)`,
                      );
                    }}
                  >
                    <Each table="category_accounts" recordName="account">
                      <tr>
                        <td className="pl-4">{sql`account.account_name`}</td>
                        <td className="text-right">
                          {sql`format.currency(account.balance, 'USD')`}
                        </td>
                      </tr>
                    </Each>
                  </Data>
                  <tr className="font-semibold border-t border-divider">
                    <td>Total {sql`category.account_category`}</td>
                    <td className="text-right">
                      {sql`format.currency(category.category_total, 'USD')`}
                    </td>
                  </tr>
                </tbody>
              </Table>
            </div>
          </Each>
          <Divider />
          <div className="flex justify-between mt-4 font-bold">
            <Typography level="body-lg">TOTAL LIABILITIES</Typography>
            <Typography level="body-lg">
              {sql`format.currency(total_liabilities, 'USD')`}
            </Typography>
          </div>
        </Card>

        {/* Equity Section */}
        <Card className="p-4">
          <Typography level="title-md" className="mb-4">EQUITY</Typography>
          <Each table="balance_sheet_equity" recordName="category">
            <div className="mb-4">
              <Typography level="body-md" className="font-semibold mb-2">
                {sql`category.account_category`}
              </Typography>
              <Table size="sm">
                <tbody>
                  <Data
                    procedure={(s) => {
                      s.defTable(
                        "category_accounts",
                        sql`select * from json_to_recordset(${sql`category.accounts`}::json)
                          as x(account_code text, account_name text, balance numeric)`,
                      );
                    }}
                  >
                    <Each table="category_accounts" recordName="account">
                      <tr>
                        <td className="pl-4">{sql`account.account_name`}</td>
                        <td className="text-right">
                          {sql`format.currency(account.balance, 'USD')`}
                        </td>
                      </tr>
                    </Each>
                  </Data>
                  <tr className="font-semibold border-t border-divider">
                    <td>Total {sql`category.account_category`}</td>
                    <td className="text-right">
                      {sql`format.currency(category.category_total, 'USD')`}
                    </td>
                  </tr>
                </tbody>
              </Table>
            </div>
          </Each>
          <Divider />
          <div className="flex justify-between mt-4 font-bold">
            <Typography level="body-lg">TOTAL EQUITY</Typography>
            <Typography level="body-lg">
              {sql`format.currency(total_equity, 'USD')`}
            </Typography>
          </div>
        </Card>

        {/* Total Liabilities & Equity */}
        <Card className="p-4 bg-level1">
          <div className="flex justify-between font-bold">
            <Typography level="body-lg">TOTAL LIABILITIES & EQUITY</Typography>
            <Typography level="body-lg">
              {sql`format.currency(total_liabilities + total_equity, 'USD')`}
            </Typography>
          </div>
        </Card>
      </div>
    </Data>
  );
}
