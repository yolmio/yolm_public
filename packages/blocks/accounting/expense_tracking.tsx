import { type Sql, sql } from "std/sql_utils";
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
import { ModalDialog } from "components/modal";
import { Checkbox } from "components/checkbox";
import { Textarea } from "components/textarea";
import type { DomStatements } from "std/statements";

export function OrderExpenseEntry() {
  const addExpense = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Insert the expense
        s.modify(sql`
          insert into db.order_expenses (
            order_id,
            expense_type,
            amount_incurred,
            amount_billed,
            amount_paid_researcher,
            description
          ) values (
            ui.selected_order_id,
            ui.expense_type,
            ui.amount_incurred,
            case when ui.is_billable then ui.amount_billed else 0 end,
            ui.amount_paid_researcher,
            ui.description
          )
        `);

        // Create journal entries if amounts are set
        s.if(sql`ui.amount_incurred > 0`, (s) => {
          s.modify(sql`
            insert into db.journal_entries (
              entry_type,
              entry_date,
              description
            ) values (
              'expense',
              current_date(),
              'Expense: ' || ui.description
            )
          `);
        });

        s.commitTransaction();
        s.refetch();

        // Reset form
        s.setScalar("expense_modal_open", sql.false);
        s.setScalar("expense_type", sql.lit`search_fee`);
        s.setScalar("amount_incurred", sql`0`);
        s.setScalar("amount_billed", sql`0`);
        s.setScalar("amount_paid_researcher", sql`0`);
        s.setScalar("description", sql.lit``);
        s.setScalar("is_billable", sql.true);
      },
    });
  };

  const addCaseFee = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Insert the case fee
        s.modify(sql`
          insert into db.order_case_fees (
            order_case_id,
            fee_type,
            amount,
            description
          ) values (
            ui.selected_case_id,
            ui.case_fee_type,
            ui.case_fee_amount,
            ui.case_fee_description
          )
        `);

        s.commitTransaction();
        s.refetch();

        // Reset form
        s.setScalar("case_fee_modal_open", sql.false);
        s.setScalar("case_fee_type", sql.lit`court_file_pull_fee`);
        s.setScalar("case_fee_amount", sql`0`);
        s.setScalar("case_fee_description", sql.lit``);
      },
    });
  };

  const applySurcharges = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Apply first case surcharge if applicable
        s.if(sql`order_surcharges.first_case_surcharge > 0`, (s) => {
          s.modify(sql`
            insert into db.order_expenses (
              order_id,
              expense_type,
              amount_incurred,
              amount_billed,
              amount_paid_researcher,
              description
            ) values (
              ui.selected_order_id,
              'surcharge',
              0,
              order_surcharges.first_case_surcharge,
              0,
              'First case surcharge'
            )
          `);
        });

        // Apply client type specific surcharges
        s.if(sql`order_surcharges.npe_surcharge > 0`, (s) => {
          s.modify(sql`
            insert into db.order_expenses (
              order_id,
              expense_type,
              amount_incurred,
              amount_billed,
              amount_paid_researcher,
              description
            ) values (
              ui.selected_order_id,
              'surcharge',
              0,
              order_surcharges.npe_surcharge,
              0,
              'NPE client surcharge'
            )
          `);
        });

        s.if(sql`order_surcharges.pe_surcharge > 0`, (s) => {
          s.modify(sql`
            insert into db.order_expenses (
              order_id,
              expense_type,
              amount_incurred,
              amount_billed,
              amount_paid_researcher,
              description
            ) values (
              ui.selected_order_id,
              'surcharge',
              0,
              order_surcharges.pe_surcharge,
              0,
              'PE client surcharge'
            )
          `);
        });

        s.if(sql`order_surcharges.mx_surcharge > 0`, (s) => {
          s.modify(sql`
            insert into db.order_expenses (
              order_id,
              expense_type,
              amount_incurred,
              amount_billed,
              amount_paid_researcher,
              description
            ) values (
              ui.selected_order_id,
              'surcharge',
              0,
              order_surcharges.mx_surcharge,
              0,
              'MX client surcharge'
            )
          `);
        });

        s.commitTransaction();
        s.refetch();
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_order_id", sql.null);
        s.defScalar("show_all_orders", sql.false);
        s.defScalar("expense_modal_open", sql.false);
        s.defScalar("case_fee_modal_open", sql.false);
        s.defScalar("edit_expense_id", sql.null);
        s.defScalar("selected_case_id", sql.null);

        // Form fields for expense entry
        s.defScalar("expense_type", sql.lit`search_fee`);
        s.defScalar("amount_incurred", sql`0`);
        s.defScalar("amount_billed", sql`0`);
        s.defScalar("amount_paid_researcher", sql`0`);
        s.defScalar("description", sql.lit``);
        s.defScalar("is_billable", sql.true);

        // Form fields for case fees
        s.defScalar("case_fee_type", sql.lit`court_file_pull_fee`);
        s.defScalar("case_fee_amount", sql`0`);
        s.defScalar("case_fee_description", sql.lit``);

        // Get orders that need expense tracking
        s.defTable(
          "orders_needing_expenses",
          sql`
          select
            o.id,
            o.order_number,
            o.matter_number,
            j.name as jurisdiction_name,
            c.name as client_name,
            o.search_type,
            o.status,
            o.created_at,
            count(distinct oc.id) as case_count,
            count(distinct oe.id) as expense_count,
            sum(oe.amount_billed) as total_billed,
            sum(oe.amount_incurred) as total_cost
          from db.orders o
          left join db.jurisdictions j on o.jurisdiction_id = j.id
          left join db.clients c on o.client_id = c.id
          left join db.order_cases oc on o.id = oc.order_id
          left join db.order_expenses oe on o.id = oe.order_id
          where (o.fees_calculated = false or ui.show_all_orders)
            and o.status not in ('cancelled', 'draft')
          group by o.id, o.order_number, o.matter_number, j.name, c.name, o.search_type, o.status, o.created_at
          order by o.created_at desc
        `,
        );

        // Get expenses for selected order
        s.defTable(
          "order_expenses",
          sql`
          select
            oe.id,
            oe.expense_type,
            oe.amount_incurred,
            oe.amount_billed,
            oe.amount_paid_researcher,
            oe.description,
            r.name as researcher_name
          from db.order_expenses oe
          left join db.researchers r on oe.researcher_id = r.id
          where oe.order_id = ui.selected_order_id
          order by oe.created_at desc
        `,
        );

        // Get cases for selected order
        s.defTable(
          "order_cases",
          sql`
          select
            oc.id,
            oc.case_number,
            oc.party_name,
            oc.case_type,
            oc.filed_date,
            count(distinct ocf.id) as fee_count,
            sum(ocf.amount) as total_fees
          from db.order_cases oc
          left join db.order_case_fees ocf on oc.id = ocf.order_case_id
          where oc.order_id = ui.selected_order_id
          group by oc.id, oc.case_number, oc.party_name, oc.case_type, oc.filed_date
          order by oc.case_number
        `,
        );

        // Get case fees for selected case
        s.defTable(
          "case_fees",
          sql`
          select
            id,
            fee_type,
            amount,
            description
          from db.order_case_fees
          where order_case_id = ui.selected_case_id
          order by created_at desc
        `,
        );

        // Calculate surcharges for the selected order
        s.defRecord(
          "order_surcharges",
          sql`
          select
            o.id,
            o.client_id,
            c.type as client_type,
            o.jurisdiction_id,
            o.search_type,
            count(distinct oc.id) as case_count,
            -- First case surcharge (applies to all client types)
            case when count(distinct oc.id) > 0 then 25.00 else 0 end as first_case_surcharge,
            -- NPE-specific surcharges
            case
              when c.type = 'npe' and o.search_type in ('civil', 'family') then 15.00
              else 0
            end as npe_surcharge,
            -- PE-specific surcharges
            case
              when c.type = 'pe' and j.state = 'TX' then 10.00
              else 0
            end as pe_surcharge,
            -- MX-specific surcharges
            case
              when c.type = 'mx' then 20.00
              else 0
            end as mx_surcharge
          from db.orders o
          join db.clients c on o.client_id = c.id
          left join db.jurisdictions j on o.jurisdiction_id = j.id
          left join db.order_cases oc on o.id = oc.order_id
          where o.id = ui.selected_order_id
          group by o.id, o.client_id, c.type, o.jurisdiction_id, o.search_type, j.state
        `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Order Expense Entry</Typography>
          <Checkbox
            checked={sql`show_all_orders`}
            onChange={(s) =>
              s.setScalar("show_all_orders", sql`not show_all_orders`)}
          >
            Show All Orders
          </Checkbox>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Order List */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">Orders</Typography>
            <div className="overflow-y-auto max-h-[600px]">
              <Each table="orders_needing_expenses" recordName="order">
                <div
                  dynamicClasses={[
                    {
                      classes:
                        "p-3 cursor-pointer rounded bg-primary-soft border border-primary-outlined mb-2",
                      condition: sql`selected_order_id = order.id`,
                    },
                    {
                      classes:
                        "p-3 cursor-pointer rounded hover:bg-surface border border-divider mb-2",
                      condition: sql`selected_order_id != order.id`,
                    },
                  ]}
                  onClick={(s) =>
                    s.setScalar("selected_order_id", sql`order.id`)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <Typography level="body-md" className="font-semibold">
                        {sql`order.order_number`}
                      </Typography>
                      <Typography level="body-sm" className="text-secondary">
                        {sql`order.client_name`}
                      </Typography>
                      <Typography level="body-xs" className="text-tertiary">
                        {sql`order.jurisdiction_name`} •{" "}
                        {sql`order.search_type`}
                      </Typography>
                    </div>
                    <div className="text-right">
                      <Typography level="body-xs" className="text-secondary">
                        Cases: {sql`order.case_count`}
                      </Typography>
                      <Typography level="body-xs" className="text-secondary">
                        Expenses: {sql`order.expense_count`}
                      </Typography>
                    </div>
                  </div>
                </div>
              </Each>
            </div>
          </Card>

          {/* Main Content Area */}
          <div className="col-span-2">
            <Show when={sql`selected_order_id is not null`}>
              {/* Surcharge Summary */}
              <Card className="p-4 mb-4">
                <div className="flex justify-between items-center mb-4">
                  <Typography level="title-md">Surcharges</Typography>
                  <Button
                    variant="solid"
                    color="primary"
                    size="sm"
                    onClick={(s) => applySurcharges(s)}
                    disabled={sql`
                    order_surcharges.first_case_surcharge = 0
                    and order_surcharges.npe_surcharge = 0
                    and order_surcharges.pe_surcharge = 0
                    and order_surcharges.mx_surcharge = 0
                  `}
                  >
                    Apply Surcharges
                  </Button>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <Show when={sql`order_surcharges.first_case_surcharge > 0`}>
                    <div className="p-2 bg-warning-soft rounded">
                      <Typography level="body-sm" className="text-warning-soft">
                        First Case
                      </Typography>
                      <Typography level="body-md" className="font-semibold">
                        {sql`format.currency(order_surcharges.first_case_surcharge, 'USD')`}
                      </Typography>
                    </div>
                  </Show>
                  <Show when={sql`order_surcharges.npe_surcharge > 0`}>
                    <div className="p-2 bg-primary-soft rounded">
                      <Typography level="body-sm" className="text-primary-soft">
                        NPE
                      </Typography>
                      <Typography level="body-md" className="font-semibold">
                        {sql`format.currency(order_surcharges.npe_surcharge, 'USD')`}
                      </Typography>
                    </div>
                  </Show>
                  <Show when={sql`order_surcharges.pe_surcharge > 0`}>
                    <div className="p-2 bg-success-soft rounded">
                      <Typography level="body-sm" className="text-success-soft">
                        PE
                      </Typography>
                      <Typography level="body-md" className="font-semibold">
                        {sql`format.currency(order_surcharges.pe_surcharge, 'USD')`}
                      </Typography>
                    </div>
                  </Show>
                  <Show when={sql`order_surcharges.mx_surcharge > 0`}>
                    <div className="p-2 bg-danger-soft rounded">
                      <Typography level="body-sm" className="text-danger-soft">
                        MX
                      </Typography>
                      <Typography level="body-md" className="font-semibold">
                        {sql`format.currency(order_surcharges.mx_surcharge, 'USD')`}
                      </Typography>
                    </div>
                  </Show>
                </div>
              </Card>

              {/* Order Expenses */}
              <Card className="p-4 mb-4">
                <div className="flex justify-between items-center mb-4">
                  <Typography level="title-md">Order Expenses</Typography>
                  <Button
                    variant="solid"
                    color="primary"
                    size="sm"
                    onClick={(s) => {
                      s.setScalar("expense_modal_open", sql.true);
                      s.setScalar("edit_expense_id", sql.null);
                    }}
                  >
                    <MaterialIcon icon="Add" className="mr-1" />
                    Add Expense
                  </Button>
                </div>

                <Table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Cost</th>
                      <th>Billed</th>
                      <th>Researcher</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Each table="order_expenses" recordName="expense">
                      <tr>
                        <td>{sql`expense.expense_type`}</td>
                        <td>{sql`expense.description`}</td>
                        <td>
                          {sql`format.currency(expense.amount_incurred, 'USD')`}
                        </td>
                        <td>
                          {sql`format.currency(expense.amount_billed, 'USD')`}
                        </td>
                        <td>
                          <Show when={sql`expense.amount_paid_researcher > 0`}>
                            {sql`format.currency(expense.amount_paid_researcher, 'USD')`}
                            <Show
                              when={sql`expense.researcher_name is not null`}
                            >
                              <br />
                              <Typography
                                level="body-xs"
                                className="text-secondary"
                              >
                                {sql`expense.researcher_name`}
                              </Typography>
                            </Show>
                          </Show>
                        </td>
                      </tr>
                    </Each>
                  </tbody>
                </Table>
              </Card>

              {/* Order Cases */}
              <Card className="p-4">
                <Typography level="title-md" className="mb-4">
                  Order Cases
                </Typography>
                <Table>
                  <thead>
                    <tr>
                      <th>Case #</th>
                      <th>Party</th>
                      <th>Type</th>
                      <th>Filed</th>
                      <th>Fees</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Each table="order_cases" recordName="case">
                      <tr>
                        <td>{sql`case.case_number`}</td>
                        <td>{sql`case.party_name`}</td>
                        <td>{sql`case.case_type`}</td>
                        <td>{sql`format.date(case.filed_date, '%Y-%m-%d')`}</td>
                        <td>
                          <Show when={sql`case.fee_count > 0`}>
                            {sql`case.fee_count`} fees •{" "}
                            {sql`format.currency(case.total_fees, 'USD')`}
                          </Show>
                        </td>
                        <td>
                          <Button
                            variant="outlined"
                            size="sm"
                            onClick={(s) => {
                              s.setScalar("selected_case_id", sql`case.id`);
                              s.setScalar("case_fee_modal_open", sql.true);
                            }}
                          >
                            Add Fee
                          </Button>
                        </td>
                      </tr>
                    </Each>
                  </tbody>
                </Table>
              </Card>
            </Show>

            <Show when={sql`selected_order_id is null`}>
              <Card className="p-8 text-center">
                <MaterialIcon
                  icon="Receipt"
                  className="text-6xl text-tertiary mb-4"
                />
                <Typography level="body-lg" className="text-tertiary">
                  Select an order to manage expenses
                </Typography>
              </Card>
            </Show>
          </div>
        </div>

        {/* Expense Entry Modal */}
        <ModalDialog
          open={sql`expense_modal_open`}
          onClose={(s) => s.setScalar("expense_modal_open", sql.false)}
          title="Add Order Expense"
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Expense Type</FormLabel>
              <Select
                value={sql`expense_type`}
                onChange={(s) => s.setScalar("expense_type", sql`target_value`)}
                variant="outlined"
                fullWidth
              >
                <Select.Option value="search_fee">Search Fee</Select.Option>
                <Select.Option value="court_fee">Court Fee</Select.Option>
                <Select.Option value="court_copy_docket_fee">
                  Copy/Docket Fee
                </Select.Option>
                <Select.Option value="researcher_expense">
                  Researcher Expense
                </Select.Option>
                <Select.Option value="surcharge">Surcharge</Select.Option>
                <Select.Option value="miscellaneous_expense">
                  Miscellaneous
                </Select.Option>
                <Select.Option value="unbillable">Unbillable</Select.Option>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Amount Incurred</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`amount_incurred`}
                onInput={(s) =>
                  s.setScalar("amount_incurred", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl>
              <Checkbox
                checked={sql`is_billable`}
                onChange={(s) =>
                  s.setScalar("is_billable", sql`not is_billable`)}
              >
                Billable to Client
              </Checkbox>
            </FormControl>

            <Show when={sql`is_billable`}>
              <FormControl fullWidth>
                <FormLabel>Amount to Bill</FormLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={sql`amount_billed`}
                  onInput={(s) =>
                    s.setScalar("amount_billed", sql`target_value`)}
                  variant="outlined"
                  fullWidth
                />
              </FormControl>
            </Show>

            <FormControl fullWidth>
              <FormLabel>Amount Paid to Researcher</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`amount_paid_researcher`}
                onInput={(s) =>
                  s.setScalar("amount_paid_researcher", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Description</FormLabel>
              <Textarea
                value={sql`description`}
                onChange={(s) => s.setScalar("description", sql`target_value`)}
                rows={3}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("expense_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => addExpense(s)}
              >
                Add Expense
              </Button>
            </div>
          </div>
        </ModalDialog>

        {/* Case Fee Entry Modal */}
        <ModalDialog
          open={sql`case_fee_modal_open`}
          onClose={(s) => s.setScalar("case_fee_modal_open", sql.false)}
          title="Add Case Fee"
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Fee Type</FormLabel>
              <Select
                value={sql`case_fee_type`}
                onChange={(s) =>
                  s.setScalar("case_fee_type", sql`target_value`)}
                variant="outlined"
                fullWidth
              >
                <Select.Option value="court_file_pull_fee">
                  Court File Pull
                </Select.Option>
                <Select.Option value="court_copy_docket_fee">
                  Copy/Docket Fee
                </Select.Option>
                <Select.Option value="court_search_fee">
                  Court Search Fee
                </Select.Option>
                <Select.Option value="researcher_expense">
                  Researcher Expense
                </Select.Option>
                <Select.Option value="unbillable_court_fee">
                  Unbillable Court Fee
                </Select.Option>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Amount</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`case_fee_amount`}
                onInput={(s) =>
                  s.setScalar("case_fee_amount", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Description</FormLabel>
              <Textarea
                value={sql`case_fee_description`}
                onChange={(s) =>
                  s.setScalar("case_fee_description", sql`target_value`)}
                rows={3}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("case_fee_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => addCaseFee(s)}
              >
                Add Fee
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}

export function FeeVerification() {
  const verifyFees = (orderId: Sql) => (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.modify(sql`
          update db.orders
          set fees_calculated = true
          where id = ${orderId}
        `);
        s.refetch();
      },
    });
  };

  const verifyAllFees = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.modify(sql`
          update db.orders o
          set fees_calculated = true
          where o.id in (select id from orders_for_verification)
        `);
        s.refetch();
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_period", sql.lit`current_month`);
        s.defScalar("verification_status", sql.lit`pending`);
        s.defScalar("selected_order_id", sql.null);

        // Get orders that need fee verification
        s.defTable(
          "orders_for_verification",
          sql`
          select
            o.id,
            o.order_number,
            o.matter_number,
            c.name as client_name,
            j.name as jurisdiction_name,
            o.search_type,
            o.completed_at,
            o.fees_calculated,
            count(distinct oe.id) as expense_count,
            sum(oe.amount_incurred) as total_cost,
            sum(oe.amount_billed) as total_revenue,
            sum(oe.amount_billed) - sum(oe.amount_incurred) as margin,
            case
              when sum(oe.amount_billed) > 0
              then round((sum(oe.amount_billed) - sum(oe.amount_incurred)) / sum(oe.amount_billed) * 100, 2)
              else 0
            end as margin_percent
          from db.orders o
          join db.clients c on o.client_id = c.id
          left join db.jurisdictions j on o.jurisdiction_id = j.id
          left join db.order_expenses oe on o.id = oe.order_id
          where o.status in ('completed', 'delivered')
            and o.invoice_id is null
            and case ui.selected_period
              when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
              when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
              when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
              else true
            end
            and case ui.verification_status
              when 'pending' then not o.fees_calculated
              when 'verified' then o.fees_calculated
              else true
            end
          group by o.id, o.order_number, o.matter_number, c.name, j.name, o.search_type, o.completed_at, o.fees_calculated
          having count(distinct oe.id) > 0
          order by o.completed_at desc
        `,
        );

        // Get detailed expenses for selected order
        s.defTable(
          "order_expense_details",
          sql`
          select
            oe.id,
            oe.expense_type,
            oe.amount_incurred,
            oe.amount_billed,
            oe.amount_paid_researcher,
            oe.description,
            r.name as researcher_name,
            oc.case_number
          from db.order_expenses oe
          left join db.researchers r on oe.researcher_id = r.id
          left join db.order_cases oc on oe.order_case_id = oc.id
          where oe.order_id = ui.selected_order_id
          order by oe.expense_type, oe.created_at
        `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Fee Verification</Typography>

        <div className="flex justify-between items-center">
          <div className="flex gap-4">
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
              <Select.Option value="all">All Time</Select.Option>
            </Select>

            <Select
              value={sql`verification_status`}
              onChange={(s) =>
                s.setScalar("verification_status", sql`target_value`)}
              variant="outlined"
              size="sm"
            >
              <Select.Option value="pending">
                Pending Verification
              </Select.Option>
              <Select.Option value="verified">Already Verified</Select.Option>
              <Select.Option value="all">All Orders</Select.Option>
            </Select>
          </div>

          <Button
            variant="solid"
            color="primary"
            onClick={(s) => verifyAllFees(s)}
            disabled={sql`verification_status != 'pending' or (select count(*) from orders_for_verification where not fees_calculated) = 0`}
          >
            Verify All
          </Button>
        </div>

        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Order #</th>
                <th>Client</th>
                <th>Jurisdiction</th>
                <th>Type</th>
                <th>Expenses</th>
                <th>Revenue</th>
                <th>Cost</th>
                <th>Margin</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <Each table="orders_for_verification" recordName="order">
                <tr
                  className="cursor-pointer hover:bg-surface"
                  onClick={(s) =>
                    s.setScalar("selected_order_id", sql`order.id`)}
                >
                  <td>{sql`order.order_number`}</td>
                  <td>{sql`order.client_name`}</td>
                  <td>{sql`order.jurisdiction_name`}</td>
                  <td>{sql`order.search_type`}</td>
                  <td>{sql`order.expense_count`}</td>
                  <td>{sql`format.currency(order.total_revenue, 'USD')`}</td>
                  <td>{sql`format.currency(order.total_cost, 'USD')`}</td>
                  <td>
                    <Show when={sql`order.margin_percent >= 30`}>
                      <Chip color="success" variant="soft" size="sm">
                        {sql`order.margin_percent`}%
                      </Chip>
                    </Show>
                    <Show
                      when={sql`order.margin_percent >= 20 and order.margin_percent < 30`}
                    >
                      <Chip color="warning" variant="soft" size="sm">
                        {sql`order.margin_percent`}%
                      </Chip>
                    </Show>
                    <Show when={sql`order.margin_percent < 20`}>
                      <Chip color="danger" variant="soft" size="sm">
                        {sql`order.margin_percent`}%
                      </Chip>
                    </Show>
                  </td>
                  <td>
                    <Show when={sql`order.fees_calculated`}>
                      <Chip color="success" variant="soft" size="sm">
                        <MaterialIcon icon="Check" className="text-sm mr-1" />
                        Verified
                      </Chip>
                    </Show>
                    <Show when={sql`not order.fees_calculated`}>
                      <Chip color="warning" variant="soft" size="sm">
                        Pending
                      </Chip>
                    </Show>
                  </td>
                  <td>
                    <Show when={sql`not order.fees_calculated`}>
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={verifyFees(sql`order.id`)}
                      >
                        Verify
                      </Button>
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>

        {/* Expense Detail View */}
        <Show when={sql`selected_order_id is not null`}>
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Expense Details
            </Typography>
            <Table size="sm">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Case</th>
                  <th>Cost</th>
                  <th>Revenue</th>
                  <th>Researcher</th>
                </tr>
              </thead>
              <tbody>
                <Each table="order_expense_details" recordName="expense">
                  <tr>
                    <td>{sql`expense.expense_type`}</td>
                    <td>{sql`expense.description`}</td>
                    <td>{sql`expense.case_number`}</td>
                    <td>
                      {sql`format.currency(expense.amount_incurred, 'USD')`}
                    </td>
                    <td>
                      {sql`format.currency(expense.amount_billed, 'USD')`}
                    </td>
                    <td>
                      <Show when={sql`expense.amount_paid_researcher > 0`}>
                        {sql`format.currency(expense.amount_paid_researcher, 'USD')`}
                        <Show when={sql`expense.researcher_name is not null`}>
                          ({sql`expense.researcher_name`})
                        </Show>
                      </Show>
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
