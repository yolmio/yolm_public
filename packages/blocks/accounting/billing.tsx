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
import { Textarea } from "components/textarea";
import type { DomStatements } from "std/statements";

export function ResearcherBillGenerator() {
  const calculateMissingFees = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Calculate and insert missing researcher fees
        s.forEachTable("orders_needing_calculation", "order", (s) => {
          // Insert search fee
          s.modify(sql`
              insert into db.order_expenses (
                order_id,
                researcher_id,
                expense_type,
                amount_incurred,
                amount_billed,
                amount_paid_researcher,
                description
              ) values (
                order.order_id,
                order.researcher_id,
                'search_fee',
                order.search_fee,
                0, -- Not billed to client through this
                order.search_fee,
                'Search fee for ' || order.jurisdiction_name || ' - ' || order.search_type
              )
            `);

          // Check for case fees
          s.if(sql`order.case_count > 0`, (s) => {
            // Look up case rate
            s.defScalar(
              "case_rate",
              sql`
                coalesce(
                  (select rr.rate from db.researcher_rates rr
                   where rr.researcher_id = order.researcher_id
                     and rr.jurisdiction_id = order.jurisdiction_id
                     and rr.is_active
                   limit 1),
                  0
                )
                `,
            );

            s.if(sql`case_rate > 0`, (s) => {
              s.modify(sql`
                  insert into db.order_expenses (
                    order_id,
                    researcher_id,
                    expense_type,
                    amount_incurred,
                    amount_billed,
                    amount_paid_researcher,
                    description
                  ) values (
                    order.order_id,
                    order.researcher_id,
                    'researcher_expense',
                    case_rate * order.case_count,
                    0,
                    case_rate * order.case_count,
                    'Case fee: ' || cast(order.case_count as string) || ' cases at ' || format.currency(case_rate, 'USD')
                  )
                `);
            });
          });

          s.defTable(
            "orders_with_fees",
            sql`
            select
              o.id as order_id,
              o.order_number,
              o.researcher_id,
              sum(oe.amount_paid_researcher) as total_researcher_fees
            from unbilled_researcher_orders o
            join db.order_expenses oe on o.id = oe.order_id
            where oe.researcher_id = o.researcher_id
              and oe.amount_paid_researcher > 0
            group by o.id, o.order_number, o.researcher_id
          `,
          );

          s.forEachTable("orders_with_fees", "order", (s) => {
            s.modify(sql`
              insert into db.journal_entries (
                entry_date,
                description,
                entry_type,
                status,
                reference_type,
                reference_id
              ) values (
                current_date(),
                'Researcher fees for order ' || order.order_number,
                'expense',
                'posted',
                'order',
                order.order_id
              )
            `);

            s.defScalar("je_id", sql`last_record_id(db.journal_entries)`);

            // Create journal lines
            s.modify(sql`
              insert into db.journal_lines (journal_id, account, debit, credit, researcher_id)
              values
                (je_id, 'researcher_costs', order.total_researcher_fees, 0, order.researcher_id),
                (je_id, 'accrued_expenses', 0, order.total_researcher_fees, order.researcher_id)
            `);
          });
        });

        s.commitTransaction();
        s.refetch();
      },
    });
  };

  const generateBill = (s: DomStatements) => {
    s.setScalar("generating_bill", sql.true);

    // First calculate any missing fees
    calculateMissingFees(s);

    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Generate bill number
        s.defScalar(
          "bill_number",
          sql`'BILL-' || to_char(current_date(), 'YYYYMM') || '-' || lpad(cast((select count(*) + 1 from db.ap_bills where bill_number like 'BILL-' || to_char(current_date(), 'YYYYMM') || '-%') as string), 4, '0')`,
        );

        // Create the bill
        s.modify(sql`
          insert into db.ap_bills (
            researcher_id,
            bill_number,
            bill_date,
            due_date,
            subtotal,
            tax_amount,
            total_amount,
            status,
            payment_terms,
            created_by_user
          ) values (
            ui.selected_researcher_id,
            bill_number,
            ui.bill_date,
            date.add(day, ui.due_days, ui.bill_date),
            ui.bill_subtotal,
            ui.bill_tax,
            ui.bill_total,
            'pending',
            cast(ui.due_days as string) || ' days',
            'system'
          )
        `);

        // Mark orders as researcher invoiced
        s.modify(sql`
          update db.orders
          set researcher_invoiced = true
          where id in (select id from unbilled_researcher_orders)
        `);

        s.commitTransaction();
        s.refetch();

        // Clear selection
        s.setScalar("selected_researcher_id", sql.null);
      },
      finally: (s) => {
        s.setScalar("generating_bill", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_researcher_id", sql.null);
        s.defScalar("selected_period", sql.lit`current_month`);
        s.defScalar("bill_date", sql`current_date()`);
        s.defScalar("due_days", sql`30`);
        s.defScalar("generating_bill", sql.false);
        s.defScalar("show_detail", sql.false);

        // Get researchers with unbilled orders
        s.defTable(
          "researchers_with_orders",
          sql`
      select
        r.id,
        r.name,
        r.code,
        count(distinct o.id) as order_count,
        sum(oe.amount_paid_researcher) as total_amount
      from db.researchers r
      join db.orders o on r.id = o.researcher_id
      join db.order_expenses oe on o.id = oe.order_id and oe.researcher_id = r.id
      where o.status in ('completed', 'delivered', 'invoiced')
        and o.researcher_invoiced = false
        and case ui.selected_period
          when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
          when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
          when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
          when 'custom' then true
          else true
        end
      group by r.id, r.name, r.code
      having count(distinct o.id) > 0
      order by r.name
    `,
        );

        // Get unbilled orders for selected researcher
        s.defTable(
          "unbilled_researcher_orders",
          sql`
      select
        o.id,
        o.order_number,
        o.matter_number,
        o.researcher_id,
        j.name as jurisdiction_name,
        o.search_type,
        o.completed_at,
        coalesce(sum(oe.amount_paid_researcher), 0) as researcher_fee,
        count(distinct oc.id) as case_count
      from db.orders o
      left join db.jurisdictions j on o.jurisdiction_id = j.id
      left join db.order_expenses oe on o.id = oe.order_id and oe.researcher_id = ui.selected_researcher_id
      left join db.order_cases oc on o.id = oc.order_id
      where o.researcher_id = ui.selected_researcher_id
        and o.status in ('completed', 'delivered', 'invoiced')
        and o.researcher_invoiced = false
        and case ui.selected_period
          when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
          when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
          when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
          when 'custom' then true
          else true
        end
      group by o.id, o.order_number, o.matter_number, o.researcher_id, j.name, o.search_type, o.completed_at
      order by o.completed_at desc
    `,
        );

        // Calculate fees if not already calculated
        s.defTable(
          "orders_needing_calculation",
          sql`
      select
        o.id as order_id,
        o.order_number,
        o.search_type,
        o.jurisdiction_id,
        o.client_id,
        o.researcher_id,
        j.name as jurisdiction_name,
        -- Look up researcher rates
        coalesce(
          -- Specific rate for this researcher/jurisdiction/search_type
          (select rr.rate from db.researcher_rates rr
           where rr.researcher_id = o.researcher_id
             and rr.jurisdiction_id = o.jurisdiction_id
             and rr.search_type = o.search_type
             and rr.is_active
           limit 1),
          -- Fallback to researcher/jurisdiction rate
          (select rr.rate from db.researcher_rates rr
           where rr.researcher_id = o.researcher_id
             and rr.jurisdiction_id = o.jurisdiction_id
             and rr.search_type is null
             and rr.is_active
           limit 1),
          -- Fallback to researcher default rate
          (select rr.rate from db.researcher_rates rr
           where rr.researcher_id = o.researcher_id
             and rr.jurisdiction_id is null
             and rr.search_type is null
             and rr.is_active
           limit 1),
          -- System default
          0
        ) as search_fee,
        count(distinct oc.id) as case_count
      from db.orders o
      left join db.jurisdictions j on o.jurisdiction_id = j.id
      left join db.order_cases oc on o.id = oc.order_id
      where o.researcher_id = ui.selected_researcher_id
        and o.status in ('completed', 'delivered', 'invoiced')
        and o.researcher_invoiced = false
        and not exists (
          select 1 from db.order_expenses oe
          where oe.order_id = o.id
            and oe.researcher_id = o.researcher_id
            and oe.expense_type = 'search_fee'
        )
      group by o.id, o.order_number, o.search_type, o.jurisdiction_id, o.client_id, o.researcher_id, j.name
    `,
        );

        s.defScalar(
          "bill_subtotal",
          sql`(select coalesce(sum(researcher_fee), 0) from unbilled_researcher_orders)`,
        );

        s.defScalar("bill_tax", sql`0`); // No tax for researcher bills
        s.defScalar("bill_total", sql`bill_subtotal + bill_tax`);
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Researcher Bill Generator</Typography>

        {/* Period Selection */}
        <Card className="p-4">
          <div className="grid grid-cols-3 gap-4">
            <FormControl fullWidth>
              <FormLabel>Billing Period</FormLabel>
              <Select
                value={sql`selected_period`}
                onChange={(s) =>
                  s.setScalar("selected_period", sql`target_value`)}
                variant="outlined"
              >
                <Select.Option value="current_month">
                  Current Month
                </Select.Option>
                <Select.Option value="last_month">Last Month</Select.Option>
                <Select.Option value="current_quarter">
                  Current Quarter
                </Select.Option>
                <Select.Option value="custom">Custom Range</Select.Option>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Bill Date</FormLabel>
              <Input
                type="date"
                value={sql`bill_date`}
                onInput={(s) => s.setScalar("bill_date", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Payment Terms (days)</FormLabel>
              <Input
                type="number"
                value={sql`due_days`}
                onInput={(s) => s.setScalar("due_days", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          {/* Researcher Selection */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Select Researcher
            </Typography>
            <div className="overflow-y-auto max-h-96">
              <Each table="researchers_with_orders" recordName="researcher">
                <Show when={sql`selected_researcher_id = researcher.id`}>
                  <div
                    className="p-3 cursor-pointer rounded transition-colors bg-primary-soft border border-primary-outlined mb-2"
                    onClick={(s) =>
                      s.setScalar(
                        "selected_researcher_id",
                        sql`researcher.id`,
                      )}
                  >
                    <Typography level="body-md" className="font-semibold">
                      {sql`researcher.name`}
                    </Typography>
                    <div className="flex justify-between mt-1">
                      <Typography level="body-sm" className="text-secondary">
                        {sql`researcher.order_count`} unbilled orders
                      </Typography>
                      <Typography level="body-sm" className="font-semibold">
                        {sql`format.currency(researcher.total_amount, 'USD')`}
                      </Typography>
                    </div>
                  </div>
                </Show>
                <Show when={sql`selected_researcher_id != researcher.id`}>
                  <div
                    className="p-3 cursor-pointer rounded transition-colors hover:bg-surface border border-divider mb-2"
                    onClick={(s) =>
                      s.setScalar(
                        "selected_researcher_id",
                        sql`researcher.id`,
                      )}
                  >
                    <Typography level="body-md" className="font-semibold">
                      {sql`researcher.name`}
                    </Typography>
                    <div className="flex justify-between mt-1">
                      <Typography level="body-sm" className="text-secondary">
                        {sql`researcher.order_count`} unbilled orders
                      </Typography>
                      <Typography level="body-sm" className="font-semibold">
                        {sql`format.currency(researcher.total_amount, 'USD')`}
                      </Typography>
                    </div>
                  </div>
                </Show>
              </Each>
            </div>
          </Card>

          {/* Bill Preview */}
          <Card className="p-4">
            <Show when={sql`selected_researcher_id is not null`}>
              <Typography level="title-md" className="mb-4">
                Bill Preview
              </Typography>

              <div className="space-y-4">
                <div>
                  <Typography level="body-sm" className="text-secondary">
                    Bill Date
                  </Typography>
                  <Typography level="body-md">
                    {sql`format.date(bill_date, '%Y/%m/%d')`}
                  </Typography>
                </div>

                <div>
                  <Typography level="body-sm" className="text-secondary">
                    Due Date
                  </Typography>
                  <Typography level="body-md">
                    {sql`format.date(date.add(day, ui.due_days, ui.bill_date), '%Y/%m/%d')`}
                  </Typography>
                </div>

                <Show
                  when={sql`(select count(*) from orders_needing_calculation) > 0`}
                >
                  <div className="p-2 bg-warning-soft text-warning-soft rounded">
                    <Typography level="body-sm">
                      <MaterialIcon icon="Warning" className="text-sm mr-1" />
                      {sql`(select count(*) from orders_needing_calculation)`}
                      {" "}
                      orders need fee calculation
                    </Typography>
                  </div>
                </Show>

                <div className="pt-4 border-t border-divider">
                  <div className="flex justify-between mb-2">
                    <Typography level="body-md">Subtotal</Typography>
                    <Typography level="body-md">
                      {sql`format.currency(bill_subtotal, 'USD')`}
                    </Typography>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-divider">
                    <Typography level="title-md">Total</Typography>
                    <Typography level="title-md">
                      {sql`format.currency(bill_total, 'USD')`}
                    </Typography>
                  </div>
                </div>

                <Button
                  variant="solid"
                  color="primary"
                  onClick={(s) => generateBill(s)}
                  disabled={sql`generating_bill or bill_total = 0`}
                  fullWidth
                >
                  Generate Bill
                </Button>
              </div>
            </Show>
            <Show when={sql`selected_researcher_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Receipt"
                  className="text-4xl text-tertiary mb-2"
                />
                <Typography level="body-sm" className="text-tertiary">
                  Select a researcher to preview bill
                </Typography>
              </div>
            </Show>
          </Card>
        </div>

        <Show when={sql`selected_researcher_id is not null`}>
          <Card className="p-4">
            <div className="flex justify-between items-center mb-4">
              <Typography level="title-md">Unbilled Orders</Typography>
              <Button
                variant="outlined"
                size="sm"
                onClick={(s) =>
                  s.setScalar("show_detail", sql`not show_detail`)}
              >
                <Show when={sql`show_detail`}>Hide Details</Show>
                <Show when={sql`not show_detail`}>Show Details</Show>
              </Button>
            </div>
            <Table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Matter #</th>
                  <th>Jurisdiction</th>
                  <th>Type</th>
                  <th>Cases</th>
                  <th>Completed</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                <Each table="unbilled_researcher_orders" recordName="order">
                  <tr>
                    <td>{sql`order.order_number`}</td>
                    <td>{sql`order.matter_number`}</td>
                    <td>{sql`order.jurisdiction_name`}</td>
                    <td>{sql`order.search_type`}</td>
                    <td>{sql`order.case_count`}</td>
                    <td>
                      {sql`format.date(order.completed_at, '%Y/%m/%d')`}
                    </td>
                    <td>
                      {sql`format.currency(order.researcher_fee, 'USD')`}
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

export function BillApprovalWorkflow() {
  const approveBill = (s: DomStatements) => {
    s.setScalar("processing", sql.true);
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Update bill status
        s.modify(sql`
          update db.ap_bills
          set
            status = 'approved',
            approved_date = current_date(),
            approved_by = current_user,
            notes = case
              when ui.approval_notes != ''
              then coalesce(notes, '') || '\nApproval notes: ' || ui.approval_notes
              else notes
            end
          where id = ui.selected_bill_id
        `);

        // Create journal entry for moving from accrued to payable
        s.modify(sql`
          insert into db.journal_entries (
            entry_date,
            description,
            entry_type,
            status,
            reference_type,
            reference_id
          ) values (
            current_date(),
            'Bill approved: Moving from accrued to payable',
            'accrual',
            'posted',
            'ap_bill',
            ui.selected_bill_id
          )
        `);

        s.defScalar("journal_id", sql`last_record_id(db.journal_entries)`);

        // Get total amount from the bill
        s.defScalar(
          "bill_total",
          sql`(select total_amount from db.ap_bills where id = ui.selected_bill_id)`,
        );

        // Create journal lines to move from accrued to payable
        s.modify(sql`
          insert into db.journal_lines (journal_id, account, debit, credit)
          values
            (journal_id, 'accrued_expenses', bill_total, 0),
            (journal_id, 'accounts_payable', 0, bill_total)
        `);

        s.commitTransaction();
        s.refetch();

        // Clear selection
        s.setScalar("selected_bill_id", sql.null);
        s.setScalar("approval_notes", sql.lit``);
      },
      finally: (s) => {
        s.setScalar("processing", sql.false);
      },
    });
  };

  const rejectBill = (s: DomStatements) => {
    s.setScalar("processing", sql.true);
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Update bill status
        s.modify(sql`
          update db.ap_bills
          set
            status = 'disputed',
            notes = case
              when ui.approval_notes != ''
              then coalesce(notes, '') || '\nDispute notes: ' || ui.approval_notes
              else notes
            end
          where id = ui.selected_bill_id
        `);

        s.commitTransaction();
        s.refetch();

        // Clear selection
        s.setScalar("selected_bill_id", sql.null);
        s.setScalar("approval_notes", sql.lit``);
      },
      finally: (s) => {
        s.setScalar("processing", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_bill_id", sql.null);
        s.defScalar("approval_notes", sql.lit``);
        s.defScalar("show_paid_bills", sql.false);
        s.defScalar("processing", sql.false);

        s.defTable(
          "pending_bills",
          sql`
      select
        b.id,
        b.bill_number,
        r.name as researcher_name,
        r.code as researcher_code,
        b.bill_date,
        b.due_date,
        b.total_amount,
        b.status,
        b.created_at,
        b.notes,
        case
          when b.due_date < current_date() then 'overdue'
          when b.due_date <= current_date() + interval '7 days' then 'due_soon'
          else 'ok'
        end as due_status
      from db.ap_bills b
      join db.researchers r on b.researcher_id = r.id
      where (not ui.show_paid_bills and b.status in ('pending', 'approved'))
         or (ui.show_paid_bills)
      order by
        case when b.status = 'pending' then 0 else 1 end,
        b.due_date
    `,
        );

        s.defTable(
          "bill_details",
          sql`
      select
        o.order_number,
        o.matter_number,
        j.name as jurisdiction_name,
        o.search_type,
        sum(oe.amount_paid_researcher) as amount
      from db.orders o
      join db.order_expenses oe on o.id = oe.order_id
      left join db.jurisdictions j on o.jurisdiction_id = j.id
      where oe.researcher_id = (select researcher_id from db.ap_bills where id = ui.selected_bill_id)
        and o.status in ('completed', 'delivered', 'invoiced')
        and o.researcher_invoiced = false
      group by o.order_number, o.matter_number, j.name, o.search_type
      order by o.order_number
    `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Bill Approval Workflow</Typography>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sql`show_paid_bills`}
              onChange={(s) =>
                s.setScalar("show_paid_bills", sql`not show_paid_bills`)}
            />
            <Typography level="body-sm">Show paid bills</Typography>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Bill List */}
          <div className="col-span-2">
            <Card className="p-4">
              <Typography level="title-md" className="mb-4">
                Pending Bills
              </Typography>
              <Table>
                <thead>
                  <tr>
                    <th>Bill #</th>
                    <th>Researcher</th>
                    <th>Bill Date</th>
                    <th>Due Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <Each table="pending_bills" recordName="bill">
                    <tr
                      dynamicClasses={[
                        {
                          classes: "bg-primary-soft",
                          condition: sql`selected_bill_id = bill.id`,
                        },
                        {
                          classes: "hover:bg-surface cursor-pointer",
                          condition: sql`selected_bill_id != bill.id`,
                        },
                      ]}
                      onClick={(s) =>
                        s.setScalar("selected_bill_id", sql`bill.id`)}
                    >
                      <td>{sql`bill.bill_number`}</td>
                      <td>{sql`bill.researcher_name`}</td>
                      <td>{sql`format.date(bill.bill_date, '%Y-%m-%d')`}</td>
                      <td>
                        <Show when={sql`bill.due_status = 'overdue'`}>
                          <span className="text-danger-600">
                            {sql`format.date(bill.due_date, '%Y-%m-%d')`}
                          </span>
                        </Show>
                        <Show when={sql`bill.due_status = 'due_soon'`}>
                          <span className="text-warning-600">
                            {sql`format.date(bill.due_date, '%Y-%m-%d')`}
                          </span>
                        </Show>
                        <Show when={sql`bill.due_status = 'ok'`}>
                          {sql`format.date(bill.due_date, '%Y-%m-%d')`}
                        </Show>
                      </td>
                      <td>
                        {sql`format.currency(bill.total_amount, 'USD')`}
                      </td>
                      <td>
                        <Chip
                          dynamicClasses={[
                            {
                              classes: "bg-warning-soft text-warning-soft",
                              condition: sql`bill.status = 'pending'`,
                            },
                            {
                              classes: "bg-success-soft text-success-soft",
                              condition: sql`bill.status = 'approved'`,
                            },
                            {
                              classes: "bg-neutral-soft text-neutral-soft",
                              condition: sql`bill.status = 'paid'`,
                            },
                            {
                              classes: "bg-danger-soft text-danger-soft",
                              condition: sql`bill.status = 'disputed'`,
                            },
                          ]}
                          size="sm"
                        >
                          {sql`bill.status`}
                        </Chip>
                      </td>
                    </tr>
                  </Each>
                </tbody>
              </Table>
            </Card>
          </div>

          {/* Bill Detail and Actions */}
          <Card className="p-4">
            <Show when={sql`selected_bill_id is not null`}>
              <Typography level="title-md" className="mb-4">
                Bill Details
              </Typography>

              <div className="space-y-4 mb-6">
                <Table size="sm">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Jurisdiction</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Each table="bill_details" recordName="detail">
                      <tr>
                        <td>{sql`detail.order_number`}</td>
                        <td>{sql`detail.jurisdiction_name`}</td>
                        <td>{sql`format.currency(detail.amount, 'USD')`}</td>
                      </tr>
                    </Each>
                  </tbody>
                </Table>

                <FormControl fullWidth>
                  <FormLabel>Approval Notes</FormLabel>
                  <Textarea
                    value={sql`approval_notes`}
                    onChange={(s) =>
                      s.setScalar("approval_notes", sql`target_value`)}
                    rows={3}
                    variant="outlined"
                  />
                </FormControl>

                <Show
                  when={sql`(select status from pending_bills where id = selected_bill_id) = 'pending'`}
                >
                  <div className="flex gap-2">
                    <Button
                      variant="solid"
                      color="success"
                      onClick={(s) => approveBill(s)}
                      disabled={sql`processing`}
                      fullWidth
                    >
                      <MaterialIcon icon="Check" className="mr-1" />
                      Approve
                    </Button>
                    <Button
                      variant="solid"
                      color="danger"
                      onClick={(s) => rejectBill(s)}
                      disabled={sql`processing`}
                      fullWidth
                    >
                      <MaterialIcon icon="Close" className="mr-1" />
                      Dispute
                    </Button>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={sql`selected_bill_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Description"
                  className="text-4xl text-tertiary mb-2"
                />
                <Typography level="body-sm" className="text-tertiary">
                  Select a bill to view details
                </Typography>
              </div>
            </Show>
          </Card>
        </div>
      </div>
    </Data>
  );
}

export function ResearcherPaymentTracking() {
  const processPayment = (billId: Sql) => (s: DomStatements) => {
    s.setScalar("processing_payment", sql.true);
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Get bill details
        s.defRecord(
          "bill",
          sql`select * from db.ap_bills where id = ${billId}`,
        );

        // Create payment record
        s.modify(sql`
          insert into db.ap_payments (
            bill_id,
            researcher_id,
            amount,
            payment_date,
            payment_method,
            status
          ) values (
            ${billId},
            bill.researcher_id,
            bill.total_amount,
            current_date(),
            'Check',
            'pending'
          )
        `);

        s.defScalar(
          "payment_id",
          sql`(select id from db.ap_payments order by id desc limit 1)`,
        );

        // Update bill status
        s.modify(sql`
          update db.ap_bills
          set
            status = 'paid',
            paid_date = current_date()
          where id = ${billId}
        `);

        // Create journal entries for payment
        s.modify(sql`
          insert into db.journal_entries (

            entry_type,
            entry_date,
            account,
            amount,
            researcher_id,
            ap_bill_id,
            description
          ) values
          (
            'statutory',
            'payment',
            current_date(),
            'accounts_payable',
            bill.total_amount,
            bill.researcher_id,
            ${billId},
            'Payment for bill ' || bill.bill_number
          ),
          (
            'statutory',
            'payment',
            current_date(),
            'cash',
            -bill.total_amount,
            bill.researcher_id,
            ${billId},
            'Payment for bill ' || bill.bill_number
          )
        `);

        s.commitTransaction();
        s.refetch();
      },
      finally: (s) => {
        s.setScalar("processing_payment", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_researcher_id", sql.null);
        s.defScalar("date_range", sql.lit`last_90_days`);
        s.defScalar("selected_payment_id", sql.null);
        s.defScalar("processing_payment", sql.false);

        // Get all researchers
        s.defTable(
          "researchers",
          sql`
      select
        r.id,
        r.name,
        r.code,
        count(distinct b.id) as total_bills,
        sum(case when b.status = 'paid' then b.total_amount else 0 end) as total_paid,
        sum(case when b.status in ('approved', 'pending') then b.total_amount else 0 end) as total_pending
      from db.researchers r
      left join db.ap_bills b on r.id = b.researcher_id
      where r.is_active
      group by r.id, r.name, r.code
      order by r.name
    `,
        );

        // Payment history for selected researcher
        s.defTable(
          "payment_history",
          sql`
      select
        p.id,
        p.payment_date,
        p.amount,
        p.payment_method,
        p.check_number,
        p.status,
        p.cleared_at,
        b.bill_number,
        b.bill_date
      from db.ap_payments p
      join db.ap_bills b on p.bill_id = b.id
      where p.researcher_id = ui.selected_researcher_id
        and case ui.date_range
          when 'last_30_days' then p.payment_date >= current_date() - interval '30 days'
          when 'last_90_days' then p.payment_date >= current_date() - interval '90 days'
          when 'last_year' then p.payment_date >= current_date() - interval '1 year'
          else true
        end
      order by p.payment_date desc
    `,
        );

        // Approved bills ready for payment
        s.defTable(
          "approved_bills",
          sql`
      select
        b.id,
        b.bill_number,
        b.bill_date,
        b.due_date,
        b.total_amount,
        b.approved_date,
        b.approved_by,
        case
          when b.due_date < current_date() then 'overdue'
          when b.due_date <= current_date() + interval '7 days' then 'due_soon'
          else 'ok'
        end as due_status
      from db.ap_bills b
      where b.researcher_id = ui.selected_researcher_id
        and b.status = 'approved'
      order by b.due_date
    `,
        );

        // Summary stats for selected researcher
        s.defRecord(
          "researcher_summary",
          sql`
      select
        count(distinct case when b.status = 'paid' then b.id end) as bills_paid,
        count(distinct case when b.status = 'approved' then b.id end) as bills_pending_payment,
        sum(case when b.status = 'paid' then b.total_amount else 0 end) as total_paid,
        sum(case when b.status = 'approved' then b.total_amount else 0 end) as total_pending,
        avg(case when p.payment_date is not null then p.payment_date - b.due_date else null end) as avg_payment_delay_days
      from db.ap_bills b
      left join db.ap_payments p on b.id = p.bill_id
      where b.researcher_id = ui.selected_researcher_id
    `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">
            Researcher Payment Tracking
          </Typography>
          <Select
            value={sql`date_range`}
            onChange={(s) => s.setScalar("date_range", sql`target_value`)}
            variant="outlined"
            size="sm"
          >
            <Select.Option value="last_30_days">Last 30 Days</Select.Option>
            <Select.Option value="last_90_days">Last 90 Days</Select.Option>
            <Select.Option value="last_year">Last Year</Select.Option>
            <Select.Option value="all">All Time</Select.Option>
          </Select>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {/* Researcher List */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Researchers
            </Typography>
            <div className="overflow-y-auto max-h-96">
              <Each table="researchers" recordName="researcher">
                <div
                  dynamicClasses={[
                    {
                      classes:
                        "p-3 cursor-pointer rounded bg-primary-soft border border-primary-outlined mb-2",
                      condition: sql`selected_researcher_id = researcher.id`,
                    },
                    {
                      classes:
                        "p-3 cursor-pointer rounded hover:bg-surface border border-divider mb-2",
                      condition: sql`selected_researcher_id != researcher.id`,
                    },
                  ]}
                  onClick={(s) =>
                    s.setScalar(
                      "selected_researcher_id",
                      sql`researcher.id`,
                    )}
                >
                  <Typography level="body-md" className="font-semibold">
                    {sql`researcher.name`}
                  </Typography>
                  <Typography level="body-sm" className="text-secondary">
                    Code: {sql`researcher.code`}
                  </Typography>
                  <div className="mt-2 flex justify-between">
                    <Typography level="body-xs" className="text-secondary">
                      Bills: {sql`researcher.total_bills`}
                    </Typography>
                    <Typography level="body-xs" className="text-success-600">
                      Paid: {sql`format.currency(researcher.total_paid, 'USD')`}
                    </Typography>
                  </div>
                  <Show when={sql`researcher.total_pending > 0`}>
                    <Typography level="body-xs" className="text-warning-600">
                      Pending:{" "}
                      {sql`format.currency(researcher.total_pending, 'USD')`}
                    </Typography>
                  </Show>
                </div>
              </Each>
            </div>
          </Card>

          {/* Main content area */}
          <div className="col-span-3">
            <Show when={sql`selected_researcher_id is not null`}>
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4 mb-4">
                <Card className="p-4">
                  <Typography level="body-sm" className="text-secondary">
                    Bills Paid
                  </Typography>
                  <Typography level="title-lg">
                    {sql`researcher_summary.bills_paid`}
                  </Typography>
                </Card>
                <Card className="p-4">
                  <Typography level="body-sm" className="text-secondary">
                    Total Paid
                  </Typography>
                  <Typography level="title-lg">
                    {sql`format.currency(researcher_summary.total_paid, 'USD')`}
                  </Typography>
                </Card>
                <Card className="p-4">
                  <Typography level="body-sm" className="text-secondary">
                    Pending Payment
                  </Typography>
                  <Typography level="title-lg" className="text-warning-600">
                    {sql`format.currency(researcher_summary.total_pending, 'USD')`}
                  </Typography>
                </Card>
                <Card className="p-4">
                  <Typography level="body-sm" className="text-secondary">
                    Avg Payment Days
                  </Typography>
                  <Typography level="title-lg">
                    {sql`coalesce(round(researcher_summary.avg_payment_delay_days, 1), 0)`}
                  </Typography>
                </Card>
              </div>

              {/* Approved Bills Ready for Payment */}
              <Show when={sql`(select count(*) from approved_bills) > 0`}>
                <Card className="p-4 mb-4">
                  <Typography level="title-md" className="mb-4">
                    Bills Ready for Payment
                  </Typography>
                  <Table>
                    <thead>
                      <tr>
                        <th>Bill #</th>
                        <th>Bill Date</th>
                        <th>Due Date</th>
                        <th>Amount</th>
                        <th>Approved By</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Each table="approved_bills" recordName="bill">
                        <tr>
                          <td>{sql`bill.bill_number`}</td>
                          <td>
                            {sql`format.date(bill.bill_date, '%Y/%m/%d')`}
                          </td>
                          <td>
                            <Show when={sql`bill.due_status = 'overdue'`}>
                              <span className="text-danger-600">
                                {sql`format.date(bill.due_date, '%Y/%m/%d')`}
                              </span>
                            </Show>
                            <Show when={sql`bill.due_status = 'due_soon'`}>
                              <span className="text-warning-600">
                                {sql`format.date(bill.due_date, '%Y/%m/%d')`}
                              </span>
                            </Show>
                            <Show when={sql`bill.due_status = 'ok'`}>
                              {sql`format.date(bill.due_date, '%Y/%m/%d')`}
                            </Show>
                          </td>
                          <td>
                            {sql`format.currency(bill.total_amount, 'USD')`}
                          </td>
                          <td>{sql`bill.approved_by`}</td>
                          <td>
                            <Button
                              variant="solid"
                              color="primary"
                              size="sm"
                              onClick={processPayment(sql`bill.id`)}
                              disabled={sql`processing_payment`}
                            >
                              <MaterialIcon
                                icon="Payment"
                                className="mr-1"
                              />
                              Process Payment
                            </Button>
                          </td>
                        </tr>
                      </Each>
                    </tbody>
                  </Table>
                </Card>
              </Show>

              {/* Payment History */}
              <Card className="p-4">
                <Typography level="title-md" className="mb-4">
                  Payment History
                </Typography>
                <Table>
                  <thead>
                    <tr>
                      <th>Payment Date</th>
                      <th>Bill #</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Check #</th>
                      <th>Status</th>
                      <th>Cleared</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Each table="payment_history" recordName="payment">
                      <tr>
                        <td>
                          {sql`format.date(payment.payment_date, '%Y-%m-%d')`}
                        </td>
                        <td>{sql`payment.bill_number`}</td>
                        <td>
                          {sql`format.currency(payment.amount, 'USD')`}
                        </td>
                        <td>{sql`payment.payment_method`}</td>
                        <td>{sql`coalesce(payment.check_number, '-')`}</td>
                        <td>
                          <Chip
                            dynamicClasses={[
                              {
                                classes: "bg-success-soft text-success-soft",
                                condition: sql`payment.status = 'cleared'`,
                              },
                              {
                                classes: "bg-warning-soft text-warning-soft",
                                condition: sql`payment.status = 'pending'`,
                              },
                            ]}
                            size="sm"
                          >
                            {sql`payment.status`}
                          </Chip>
                        </td>
                        <td>
                          {sql`case
                          when payment.cleared_at is not null
                          then format.date(payment.cleared_at, '%Y-%m-%d')
                          else '-'
                        end`}
                        </td>
                      </tr>
                    </Each>
                  </tbody>
                </Table>
              </Card>
            </Show>
            <Show when={sql`selected_researcher_id is null`}>
              <Card className="p-8 text-center">
                <MaterialIcon
                  icon="Group"
                  className="text-6xl text-tertiary mb-4"
                />
                <Typography level="body-lg" className="text-tertiary">
                  Select a researcher to view payment details
                </Typography>
              </Card>
            </Show>
          </div>
        </div>
      </div>
    </Data>
  );
}
