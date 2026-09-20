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
import type { DomStatements } from "std/statements";
import { ModalDialog } from "components/modal";

export function InvoiceGenerator() {
  const generateInvoice = (s: DomStatements) => {
    s.setScalar("generating_invoice", sql.true);
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Generate invoice number
        s.defScalar(
          "invoice_number",
          sql`'INV-' || to_char(current_date(), 'YYYYMM') || '-' || lpad(cast((select count(*) + 1 from db.ar_invoices where invoice_number like 'INV-' || to_char(current_date(), 'YYYYMM') || '-%') as string), 4, '0')`,
        );

        // Create the invoice
        s.modify(sql`
          insert into db.ar_invoices (
            client_id,
            invoice_number,
            invoice_date,
            due_date,
            subtotal,
            tax_amount,
            total_amount,
            status,
            generated_by_user
          ) values (
            ui.selected_client_id,
            invoice_number,
            ui.invoice_date,
            date.add(day, ui.due_days, ui.invoice_date),
            ui.invoice_subtotal,
            ui.invoice_tax,
            ui.invoice_total,
            'draft',
            current_user
          )
        `);

        // Update orders to link to invoice
        s.modify(sql`
          update db.orders
          set invoice_id = last_record_id(db.ar_invoices)
          where id in (select id from ui.unbilled_orders)
        `);

        // Create journal entry
        s.modify(sql`
          insert into db.journal_entries (
            entry_date,
            description,
            entry_type,
            status
          ) values (
            ui.invoice_date,
            'Invoice ' || invoice_number,
            'revenue',
            'posted'
          )
        `);

        s.defScalar(
          "journal_id",
          sql`last_record_id(db.journal_entries)`,
        );

        // Debit AR, Credit Revenue
        s.modify(sql`
          insert into db.journal_lines (journal_id, account, debit, credit)
          values
            (journal_id, 'accounts_receivable', ui.invoice_total, 0),
            (journal_id, 'revenue', 0, ui.invoice_total)
        `);

        s.commitTransaction();
      },
      catch: (s) => {
        s.setScalar("generating_invoice", sql.false);
      },
      finally: (s) => {
        s.setScalar("generating_invoice", sql.false);
        s.setScalar("selected_client_id", sql.null);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_client_id", sql.null);
        s.defScalar("selected_period", sql.lit`current_month`);
        s.defScalar("invoice_date", sql`current_date()`);
        s.defScalar("due_days", sql`30`);
        s.defScalar("generating_invoice", sql.false);

        s.defTable(
          "clients_with_orders",
          sql`
      select
        c.id,
        c.name,
        c.code,
        count(distinct o.id) as order_count,
        sum(o.client_cost) as total_amount
      from db.clients c
      join db.orders o on c.id = o.client_id
      where o.status in ('completed', 'delivered')
        and o.invoice_id is null
        and case ui.selected_period
          when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
          when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
          when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
          when 'custom' then true
          else true
        end
      group by c.id, c.name, c.code
      having count(distinct o.id) > 0
      order by c.name
    `,
        );

        s.defTable(
          "unbilled_orders",
          sql`
      select
        o.id,
        o.order_number,
        o.matter_number,
        j.name as jurisdiction_name,
        o.search_type,
        o.completed_at,
        o.client_cost,
        o.status
      from db.orders o
      left join db.jurisdictions j on o.jurisdiction_id = j.id
      where o.client_id = ui.selected_client_id
        and o.status in ('completed', 'delivered')
        and o.invoice_id is null
        and case ui.selected_period
          when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
          when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
          when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
          when 'custom' then true
          else true
        end
      order by o.completed_at desc
    `,
        );

        s.defScalar(
          "invoice_subtotal",
          sql`(select coalesce(sum(client_cost), 0) from unbilled_orders)`,
        );

        s.defScalar("invoice_tax", sql`invoice_subtotal * 0`); // No tax by default
        s.defScalar("invoice_total", sql`invoice_subtotal + invoice_tax`);
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Invoice Generator</Typography>

        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4">
            <FormControl fullWidth>
              <FormLabel>Billing Period</FormLabel>
              <Select
                value={sql`selected_period`}
                onChange={(s) =>
                  s.setScalar("selected_period", sql`target_value`)}
                variant="outlined"
                fullWidth
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
          </Card>

          <Card className="p-4">
            <FormControl fullWidth>
              <FormLabel>Invoice Date</FormLabel>
              <Input
                type="date"
                value={sql`invoice_date`}
                onInput={(s) => s.setScalar("invoice_date", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>
          </Card>

          <Card className="p-4">
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
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Client Selection */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Select Client
            </Typography>
            <div className="overflow-y-auto max-h-96">
              <Each table="clients_with_orders" recordName="client">
                <Show when={sql`selected_client_id = client.id`}>
                  <div
                    className="p-3 cursor-pointer rounded transition-colors bg-primary-soft border border-primary-outlined mb-2"
                    onClick={(s) =>
                      s.setScalar("selected_client_id", sql`client.id`)}
                  >
                    <Typography level="body-md" className="font-semibold">
                      {sql`client.name`}
                    </Typography>
                    <div className="flex justify-between mt-1">
                      <Typography level="body-sm" className="text-secondary">
                        {sql`client.order_count`} unbilled orders
                      </Typography>
                      <Typography level="body-sm" className="font-semibold">
                        {sql`format.currency(client.total_amount, 'USD')`}
                      </Typography>
                    </div>
                  </div>
                </Show>
                <Show when={sql`selected_client_id != client.id`}>
                  <div
                    className="p-3 cursor-pointer rounded transition-colors hover:bg-surface border border-divider mb-2"
                    onClick={(s) =>
                      s.setScalar("selected_client_id", sql`client.id`)}
                  >
                    <Typography level="body-md" className="font-semibold">
                      {sql`client.name`}
                    </Typography>
                    <div className="flex justify-between mt-1">
                      <Typography level="body-sm" className="text-secondary">
                        {sql`client.order_count`} unbilled orders
                      </Typography>
                      <Typography level="body-sm" className="font-semibold">
                        {sql`format.currency(client.total_amount, 'USD')`}
                      </Typography>
                    </div>
                  </div>
                </Show>
              </Each>
            </div>
          </Card>

          {/* Invoice Preview */}
          <Card className="p-4">
            <Show when={sql`selected_client_id is not null`}>
              <Typography level="title-md" className="mb-4">
                Invoice Preview
              </Typography>

              <div className="space-y-4">
                <div>
                  <Typography level="body-sm" className="text-secondary">
                    Invoice Date
                  </Typography>
                  <Typography level="body-md">
                    {sql`format.date(invoice_date, '%Y-%m-%d')`}
                  </Typography>
                </div>

                <div>
                  <Typography level="body-sm" className="text-secondary">
                    Due Date
                  </Typography>
                  <Typography level="body-md">
                    {sql`format.date(date.add(day, ui.due_days, ui.invoice_date), '%Y-%m-%d')`}
                  </Typography>
                </div>

                <div className="pt-4 border-t border-divider">
                  <div className="flex justify-between mb-2">
                    <Typography level="body-md">Subtotal</Typography>
                    <Typography level="body-md">
                      {sql`format.currency(invoice_subtotal, 'USD')`}
                    </Typography>
                  </div>
                  <div className="flex justify-between mb-2">
                    <Typography level="body-md">Tax</Typography>
                    <Typography level="body-md">
                      {sql`format.currency(invoice_tax, 'USD')`}
                    </Typography>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-divider">
                    <Typography level="title-md">Total</Typography>
                    <Typography level="title-md">
                      {sql`format.currency(invoice_total, 'USD')`}
                    </Typography>
                  </div>
                </div>

                <Button
                  variant="solid"
                  color="primary"
                  onClick={(s) => generateInvoice(s)}
                  disabled={sql`generating_invoice or invoice_total = 0`}
                  fullWidth
                >
                  Generate Invoice
                </Button>
              </div>
            </Show>
            <Show when={sql`selected_client_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Receipt"
                  className="text-4xl text-tertiary mb-2"
                />
                <Typography level="body-sm" className="text-tertiary">
                  Select a client to preview invoice
                </Typography>
              </div>
            </Show>
          </Card>
        </div>

        <Show when={sql`selected_client_id is not null`}>
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Unbilled Orders
            </Typography>
            <Table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Matter #</th>
                  <th>Jurisdiction</th>
                  <th>Type</th>
                  <th>Completed</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                <Each table="unbilled_orders" recordName="order">
                  <tr>
                    <td>{sql`order.order_number`}</td>
                    <td>{sql`order.matter_number`}</td>
                    <td>{sql`order.jurisdiction_name`}</td>
                    <td>{sql`order.search_type`}</td>
                    <td>{sql`format.date(order.completed_at, '%Y-%m-%d')`}</td>
                    <td>{sql`format.currency(order.client_cost, 'USD')`}</td>
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

export function InvoiceListBrowse() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("filter_status", sql.lit`all`);
        s.defScalar("filter_client_id", sql.null);
        s.defScalar("date_range", sql.lit`last_90_days`);

        s.defTable(
          "invoices",
          sql`
      select
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.total_amount,
        i.status,
        i.paid_date,
        c.name as client_name,
        coalesce(sum(p.amount), 0) as amount_paid,
        i.total_amount - coalesce(sum(p.amount), 0) as balance_due
      from db.ar_invoices i
      join db.clients c on i.client_id = c.id
      left join db.ar_payments p on i.id = p.invoice_id and p.status = 'cleared'
      where
        (ui.filter_client_id is null or i.client_id = ui.filter_client_id)
        and case ui.filter_status
          when 'draft' then i.status = 'draft'
          when 'sent' then i.status = 'sent'
          when 'paid' then i.status = 'paid'
          when 'overdue' then i.status = 'sent' and i.due_date < current_date()
          else true
        end
        and case ui.date_range
          when 'last_30_days' then i.invoice_date >= current_date() - interval '30 days'
          when 'last_90_days' then i.invoice_date >= current_date() - interval '90 days'
          when 'last_year' then i.invoice_date >= current_date() - interval '1 year'
          else true
        end
      group by i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount,
               i.status, i.paid_date, c.name
      order by i.invoice_date desc
    `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Invoice List</Typography>

        <div className="flex gap-4">
          <Select
            value={sql`filter_status`}
            onChange={(s) => s.setScalar("filter_status", sql`target_value`)}
            variant="outlined"
            size="sm"
          >
            <Select.Option value="all">All Invoices</Select.Option>
            <Select.Option value="draft">Draft</Select.Option>
            <Select.Option value="sent">Sent</Select.Option>
            <Select.Option value="paid">Paid</Select.Option>
            <Select.Option value="overdue">Overdue</Select.Option>
          </Select>

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

        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Invoice Date</th>
                <th>Due Date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <Each table="invoices" recordName="invoice">
                <tr>
                  <td>{sql`invoice.invoice_number`}</td>
                  <td>{sql`invoice.client_name`}</td>
                  <td>{sql`format.date(invoice.invoice_date, '%Y-%m-%d')`}</td>
                  <td>{sql`format.date(invoice.due_date, '%Y-%m-%d')`}</td>
                  <td>{sql`format.currency(invoice.total_amount, 'USD')`}</td>
                  <td>{sql`format.currency(invoice.amount_paid, 'USD')`}</td>
                  <td>{sql`format.currency(invoice.balance_due, 'USD')`}</td>
                  <td>
                    <Chip
                      size="sm"
                      variant="soft"
                      color="primary"
                    >
                      {sql`invoice.status`}
                    </Chip>
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

export function InvoiceDetail() {
  const markAsSent = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();
        s.modify(sql`
          update db.ar_invoices
          set status = 'sent', sent_date = current_date()
          where id = ui.invoice_id and status = 'draft'
        `);
        s.commitTransaction();
      },
      finally: (s) => {
        s.setScalar("send_modal_open", sql.false);
      },
    });
  };

  const recordPayment = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Insert payment record
        s.modify(sql`
          insert into db.ar_payments (
            invoice_id,
            client_id,
            amount,
            payment_date,
            payment_method,
            reference_number,
            status,
            journal_entry_id
          ) values (
            ui.invoice_id,
            (select client_id from db.ar_invoices where id = ui.invoice_id),
            ui.payment_amount,
            ui.payment_date,
            ui.payment_method,
            ui.payment_reference,
            'pending',
            0  -- Would create proper journal entry
          )
        `);

        // Create journal entry
        s.modify(sql`
          insert into db.journal_entries (
            entry_date,
            description,
            entry_type,
            status
          ) values (
            ui.payment_date,
            'Payment for invoice ' || (select invoice_number from db.ar_invoices where id = ui.invoice_id),
            'payment',
            'posted'
          )
        `);

        s.defScalar("journal_id", sql`last_record_id(db.journal_entries)`);

        // Debit Cash, Credit AR
        s.modify(sql`
          insert into db.journal_lines (journal_id, account, debit, credit, client_id)
          values
            (journal_id, 'cash', ui.payment_amount, 0, (select client_id from db.ar_invoices where id = ui.invoice_id)),
            (journal_id, 'accounts_receivable', 0, ui.payment_amount, (select client_id from db.ar_invoices where id = ui.invoice_id))
        `);

        // Update invoice status if fully paid
        s.modify(sql`
          update db.ar_invoices
          set status = 'paid', paid_date = ui.payment_date
          where id = ui.invoice_id
            and (total_amount - (select sum(amount) from db.ar_payments where invoice_id = ui.invoice_id)) <= 0
        `);

        s.commitTransaction();
      },
      finally: (s) => {
        s.setScalar("payment_modal_open", sql.false);
        s.setScalar("payment_amount", sql`0`);
        s.setScalar("payment_reference", sql.lit``);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("invoice_id", sql`(select id from db.ar_invoices limit 1)`); // This would come from route params
        s.defScalar("send_modal_open", sql.false);
        s.defScalar("payment_modal_open", sql.false);
        s.defScalar("payment_amount", sql`0`);
        s.defScalar("payment_method", sql.lit`check`);
        s.defScalar("payment_reference", sql.lit``);
        s.defScalar("payment_date", sql`current_date()`);

        // Get invoice header
        s.defRecord(
          "invoice",
          sql`
      select
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.subtotal,
        i.tax_amount,
        i.total_amount,
        i.status,
        i.sent_date,
        i.paid_date,
        i.payment_terms,
        i.notes,
        c.name as client_name,
        c.email as client_email,
        c.address_line_1,
        c.address_line_2,
        c.city,
        c.state,
        c.postal_code,
        c.phone as client_phone,
        coalesce(sum(p.amount), 0) as amount_paid,
        i.total_amount - coalesce(sum(p.amount), 0) as balance_due
      from db.ar_invoices i
      join db.clients c on i.client_id = c.id
      left join db.ar_payments p on i.id = p.invoice_id and p.status = 'cleared'
      where i.id = ui.invoice_id
      group by i.id, i.invoice_number, i.invoice_date, i.due_date, i.subtotal,
               i.tax_amount, i.total_amount, i.status, i.sent_date, i.paid_date,
               i.payment_terms, i.notes, c.name, c.email, c.address_line_1,
               c.address_line_2, c.city, c.state, c.postal_code, c.phone
    `,
        );

        // Get invoice line items (orders)
        s.defTable(
          "invoice_orders",
          sql`
      select
        o.id,
        o.order_number,
        o.matter_number,
        j.name as jurisdiction_name,
        o.search_type,
        o.completed_at,
        o.client_cost as amount,
        count(distinct oc.id) as case_count
      from db.orders o
      left join db.jurisdictions j on o.jurisdiction_id = j.id
      left join db.order_cases oc on o.id = oc.order_id
      where o.invoice_id = ui.invoice_id
      group by o.id, o.order_number, o.matter_number, j.name,
               o.search_type, o.completed_at, o.client_cost
      order by o.completed_at
    `,
        );

        // Get payment history
        s.defTable(
          "payment_history",
          sql`
      select
        p.id,
        p.payment_date,
        p.amount,
        p.payment_method,
        p.reference_number,
        p.status,
        p.cleared_at,
        p.notes
      from db.ar_payments p
      where p.invoice_id = ui.invoice_id
      order by p.payment_date desc
    `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <Typography level="title-lg">
              Invoice {sql`invoice.invoice_number`}
            </Typography>
            <Typography level="body-sm" className="text-secondary">
              {sql`invoice.client_name`}
            </Typography>
          </div>
          <div className="flex gap-2">
            <Show when={sql`invoice.status = 'draft'`}>
              <Button
                variant="outlined"
                onClick={(s) => s.setScalar("send_modal_open", sql.true)}
              >
                Mark as Sent
              </Button>
            </Show>
            <Show
              when={sql`invoice.status = 'sent' and invoice.balance_due > 0`}
            >
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => {
                  s.setScalar("payment_modal_open", sql.true);
                  s.setScalar("payment_amount", sql`invoice.balance_due`);
                }}
              >
                Record Payment
              </Button>
            </Show>
            <Button
              variant="outlined"
              startDecorator={<MaterialIcon icon="Print" />}
            >
              Print
            </Button>
            <Button
              variant="outlined"
              startDecorator={<MaterialIcon icon="Download" />}
            >
              Download PDF
            </Button>
          </div>
        </div>

        {/* Status Banner */}
        <Card className="p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <Typography level="body-sm" className="text-secondary">
                Status:
              </Typography>
              <Show when={sql`invoice.status = 'draft'`}>
                <Chip variant="soft" color="neutral" size="lg">DRAFT</Chip>
              </Show>
              <Show when={sql`invoice.status = 'sent'`}>
                <Chip variant="soft" color="warning" size="lg">SENT</Chip>
              </Show>
              <Show when={sql`invoice.status = 'paid'`}>
                <Chip variant="soft" color="success" size="lg">PAID</Chip>
              </Show>
              <Show when={sql`invoice.status = 'overdue'`}>
                <Chip variant="soft" color="danger" size="lg">OVERDUE</Chip>
              </Show>
            </div>
            <div className="text-right">
              <Typography level="body-sm" className="text-secondary">
                Balance Due
              </Typography>
              <Typography level="title-lg">
                <Show when={sql`invoice.balance_due > 0`}>
                  <span className="text-danger-600">
                    {sql`format.currency(invoice.balance_due, 'USD')`}
                  </span>
                </Show>
                <Show when={sql`invoice.balance_due = 0`}>
                  <span className="text-success-600">$0.00</span>
                </Show>
              </Typography>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          {/* Invoice Details */}
          <Card className="col-span-2 p-6">
            <div className="mb-6">
              <Typography level="title-md">Invoice Details</Typography>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Bill To */}
              <div>
                <Typography level="body-sm" className="text-secondary mb-2">
                  Bill To
                </Typography>
                <div className="space-y-1">
                  <Typography level="body-md" className="font-semibold">
                    {sql`invoice.client_name`}
                  </Typography>
                  <Show when={sql`invoice.address_line_1 is not null`}>
                    <Typography level="body-md">
                      {sql`invoice.address_line_1`}
                    </Typography>
                  </Show>
                  <Show when={sql`invoice.address_line_2 is not null`}>
                    <Typography level="body-md">
                      {sql`invoice.address_line_2`}
                    </Typography>
                  </Show>
                  <Typography level="body-md">
                    {sql`invoice.city`}, {sql`invoice.state`}{" "}
                    {sql`invoice.postal_code`}
                  </Typography>
                  <Show when={sql`invoice.client_phone is not null`}>
                    <Typography level="body-sm" className="text-secondary">
                      {sql`invoice.client_phone`}
                    </Typography>
                  </Show>
                  <Show when={sql`invoice.client_email is not null`}>
                    <Typography level="body-sm" className="text-secondary">
                      {sql`invoice.client_email`}
                    </Typography>
                  </Show>
                </div>
              </div>

              {/* Invoice Info */}
              <div>
                <Typography level="body-sm" className="text-secondary mb-2">
                  Invoice Information
                </Typography>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Typography level="body-sm" className="text-secondary">
                      Invoice Date:
                    </Typography>
                    <Typography level="body-md">
                      {sql`format.date(invoice.invoice_date, '%Y-%m-%d')`}
                    </Typography>
                  </div>
                  <div className="flex justify-between">
                    <Typography level="body-sm" className="text-secondary">
                      Due Date:
                    </Typography>
                    <Typography level="body-md">
                      {sql`format.date(invoice.due_date, '%Y-%m-%d')`}
                    </Typography>
                  </div>
                  <div className="flex justify-between">
                    <Typography level="body-sm" className="text-secondary">
                      Payment Terms:
                    </Typography>
                    <Typography level="body-md">
                      {sql`coalesce(invoice.payment_terms, 'Net 30')`}
                    </Typography>
                  </div>
                  <Show when={sql`invoice.sent_date is not null`}>
                    <div className="flex justify-between">
                      <Typography level="body-sm" className="text-secondary">
                        Sent Date:
                      </Typography>
                      <Typography level="body-md">
                        {sql`format.date(invoice.sent_date, '%Y-%m-%d')`}
                      </Typography>
                    </div>
                  </Show>
                  <Show when={sql`invoice.paid_date is not null`}>
                    <div className="flex justify-between">
                      <Typography level="body-sm" className="text-secondary">
                        Paid Date:
                      </Typography>
                      <Typography level="body-md">
                        {sql`format.date(invoice.paid_date, '%Y-%m-%d')`}
                      </Typography>
                    </div>
                  </Show>
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="mt-8">
              <Typography level="body-sm" className="text-secondary mb-2">
                Services
              </Typography>
              <Table>
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Matter #</th>
                    <th>Jurisdiction</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Cases</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <Each table="invoice_orders" recordName="order">
                    <tr>
                      <td>{sql`order.order_number`}</td>
                      <td>{sql`order.matter_number`}</td>
                      <td>{sql`order.jurisdiction_name`}</td>
                      <td>{sql`order.search_type`}</td>
                      <td>
                        {sql`format.date(order.completed_at, '%m/%d/%y')`}
                      </td>
                      <td>{sql`order.case_count`}</td>
                      <td className="text-right">
                        {sql`format.currency(order.amount, 'USD')`}
                      </td>
                    </tr>
                  </Each>
                </tbody>
                <tfoot className="border-t-2 border-divider">
                  <tr>
                    <td colSpan={6} className="text-right">Subtotal</td>
                    <td className="text-right">
                      {sql`format.currency(invoice.subtotal, 'USD')`}
                    </td>
                  </tr>
                  <Show when={sql`invoice.tax_amount > 0`}>
                    <tr>
                      <td colSpan={6} className="text-right">Tax</td>
                      <td className="text-right">
                        {sql`format.currency(invoice.tax_amount, 'USD')`}
                      </td>
                    </tr>
                  </Show>
                  <tr className="font-bold">
                    <td colSpan={6} className="text-right">Total</td>
                    <td className="text-right">
                      {sql`format.currency(invoice.total_amount, 'USD')`}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </div>

            {/* Notes */}
            <Show when={sql`invoice.notes is not null`}>
              <div className="mt-6">
                <Typography level="body-sm" className="text-secondary mb-2">
                  Notes
                </Typography>
                <Card className="p-3 bg-surface">
                  <Typography level="body-md">{sql`invoice.notes`}</Typography>
                </Card>
              </div>
            </Show>
          </Card>

          {/* Payment History */}
          <Card className="p-6">
            <Typography level="title-md" className="mb-4">
              Payment History
            </Typography>
            <Show when={sql`(select count(*) from payment_history) > 0`}>
              <div className="space-y-3">
                <Each table="payment_history" recordName="payment">
                  <div className="p-3 bg-surface rounded">
                    <div className="flex justify-between items-start">
                      <div>
                        <Typography level="body-md" className="font-semibold">
                          {sql`format.currency(payment.amount, 'USD')`}
                        </Typography>
                        <Typography level="body-sm" className="text-secondary">
                          {sql`format.date(payment.payment_date, '%M %d, %Y')`}
                        </Typography>
                        <Typography level="body-sm" className="text-secondary">
                          {sql`payment.payment_method`}
                          <Show
                            when={sql`payment.reference_number is not null`}
                          >
                            {sql`' - ' || payment.reference_number`}
                          </Show>
                        </Typography>
                      </div>
                      <Show when={sql`payment.status = 'cleared'`}>
                        <Chip size="sm" variant="soft" color="success">
                          Cleared
                        </Chip>
                      </Show>
                      <Show when={sql`payment.status = 'pending'`}>
                        <Chip size="sm" variant="soft" color="warning">
                          Pending
                        </Chip>
                      </Show>
                    </div>
                    <Show when={sql`payment.notes is not null`}>
                      <Typography level="body-sm" className="mt-2">
                        {sql`payment.notes`}
                      </Typography>
                    </Show>
                  </div>
                </Each>
              </div>
            </Show>
            <Show when={sql`(select count(*) from payment_history) = 0`}>
              <div className="text-center py-6">
                <MaterialIcon
                  icon="Payment"
                  className="text-4xl text-tertiary mb-2"
                />
                <Typography level="body-sm" className="text-tertiary">
                  No payments recorded
                </Typography>
              </div>
            </Show>
          </Card>
        </div>

        {/* Send Modal */}
        <ModalDialog
          open={sql`send_modal_open`}
          onClose={(s) => s.setScalar("send_modal_open", sql.false)}
          title="Mark Invoice as Sent"
        >
          <div className="flex flex-col gap-4 p-4">
            <Typography level="body-md">
              Mark this invoice as sent to the client? This will update the
              status and record today as the sent date.
            </Typography>
            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("send_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => markAsSent(s)}
              >
                Mark as Sent
              </Button>
            </div>
          </div>
        </ModalDialog>

        <ModalDialog
          open={sql`payment_modal_open`}
          onClose={(s) => s.setScalar("payment_modal_open", sql.false)}
          title="Record Payment"
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Payment Amount</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`payment_amount`}
                onInput={(s) =>
                  s.setScalar("payment_amount", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
              <Typography level="body-sm" className="text-secondary mt-1">
                Balance due: {sql`format.currency(invoice.balance_due, 'USD')`}
              </Typography>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Payment Date</FormLabel>
              <Input
                type="date"
                value={sql`payment_date`}
                onInput={(s) => s.setScalar("payment_date", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Payment Method</FormLabel>
              <Select
                value={sql`payment_method`}
                onChange={(s) =>
                  s.setScalar("payment_method", sql`target_value`)}
                variant="outlined"
                fullWidth
              >
                <Select.Option value="check">Check</Select.Option>
                <Select.Option value="ach">ACH Transfer</Select.Option>
                <Select.Option value="wire">Wire Transfer</Select.Option>
                <Select.Option value="credit_card">Credit Card</Select.Option>
                <Select.Option value="cash">Cash</Select.Option>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Reference Number</FormLabel>
              <Input
                value={sql`payment_reference`}
                onInput={(s) =>
                  s.setScalar("payment_reference", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="Check #, Transaction ID, etc."
              />
            </FormControl>

            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("payment_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => recordPayment(s)}
                disabled={sql`payment_amount <= 0`}
              >
                Record Payment
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}
