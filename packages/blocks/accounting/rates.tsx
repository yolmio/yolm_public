import { sql } from "std/sql_utils";
import { Button } from "components/button";
import { Card } from "components/card";
import { EnumSelect } from "components/enum_select";
import { IconButton } from "components/icon_button";
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
import { EachSelect } from "components/each_select";
import type { DomStatements } from "std/statements";
import { Chip } from "components/chip";

export function RateDashboard() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("total_clients", sql`(select count(*) from db.clients)`);
        s.defScalar(
          "clients_with_rates",
          sql`(select count(distinct client_id) from db.client_rates where is_active)`,
        );
        s.defScalar(
          "missing_rates_count",
          sql`(select count(*) from db.missing_rates_log where not is_resolved)`,
        );

        s.defTable(
          "recent_rate_changes",
          sql`
      select
        cr.id,
        c.name as client_name,
        cr.rate_type,
        cr.amount,
        cr.effective_from,
        cr.created_at
      from db.client_rates cr
      join db.clients c on cr.client_id = c.id
      where cr.created_at > current_date() - interval '30 days'
      order by cr.created_at desc
      limit 10
    `,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <Typography level="title-lg">Rate Management Dashboard</Typography>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Total Clients
            </Typography>
            <Typography level="title-lg">{sql`total_clients`}</Typography>
          </Card>
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Clients with Rates
            </Typography>
            <Typography level="title-lg">{sql`clients_with_rates`}</Typography>
          </Card>

          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Missing Rates
            </Typography>
            <Show when={sql`missing_rates_count > 0`}>
              <Typography level="title-lg" className="text-danger-600">
                {sql`missing_rates_count`}
              </Typography>
            </Show>
            <Show when={sql`missing_rates_count = 0`}>
              <Typography level="title-lg">
                {sql`missing_rates_count`}
              </Typography>
            </Show>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <Typography level="title-lg" className="mb-4">
              Recent Rate Changes
            </Typography>
            <Table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Rate Type</th>
                  <th>Amount</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                <Each table="recent_rate_changes" recordName="change">
                  <tr>
                    <td>{sql`change.client_name`}</td>
                    <td>{sql`change.rate_type`}</td>
                    <td>{sql`format.currency(change.amount, 'USD')`}</td>
                    <td>
                      {sql`format.date(change.effective_from, '%Y-%m-%d')`}
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </div>
      </div>
    </Data>
  );
}

export function MissingRatesManager() {
  const fixMissingRate = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Get the missing rate details
        s.defRecord(
          "missing_rate",
          sql`
          select * from db.missing_rates_log
          where id = ui.selected_missing_rate_id
        `,
        );

        // Create the rate
        s.modify(sql`
          insert into db.client_rates (
            client_id,
            jurisdiction_id,
            search_type,
            rate_type,
            amount,
            effective_from,
            is_active
          ) values (
            missing_rate.client_id,
            missing_rate.jurisdiction_id,
            missing_rate.search_type,
            ui.fix_rate_type,
            ui.fix_rate_amount,
            current_date(),
            true
          )
        `);

        // Mark all occurrences as resolved
        s.modify(sql`
          update db.missing_rates_log
          set
            is_resolved = true,
            resolved_at = current_timestamp()
          where client_id = missing_rate.client_id
            and jurisdiction_id = missing_rate.jurisdiction_id
            and search_type = missing_rate.search_type
            and not is_resolved
        `);

        s.commitTransaction();
      },
      finally: (s) => {
        s.setScalar("fix_rate_modal_open", sql.false);
        s.setScalar("selected_missing_rate_id", sql.null);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("filter_resolved", sql.lit`unresolved`);
        s.defScalar("selected_missing_rate_id", sql.null);
        s.defScalar("fix_rate_modal_open", sql.false);

        // Form fields for fixing rate
        s.defScalar("fix_rate_amount", sql`0`);
        s.defScalar(
          "fix_rate_type",
          sql`'search_fee'::enums.order_expense_type`,
        );

        // Summary metrics
        s.defScalar(
          "affected_orders_count",
          sql`(select count(distinct order_id) from db.missing_rates_log where order_id is not null)`,
        );

        // Missing rates list
        s.defTable(
          "missing_rates",
          sql`
      select
        mrl.id,
        mrl.client_id,
        c.name as client_name,
        mrl.jurisdiction_id,
        j.name as jurisdiction_name,
        mrl.search_type,
        mrl.lookup_timestamp as occurred_at,
        cast(o.order_number as string) as order_reference,
        mrl.is_resolved,
        mrl.resolved_at,
        count(*) over (partition by mrl.client_id, mrl.jurisdiction_id, mrl.search_type) as occurrence_count
      from db.missing_rates_log mrl
      left join db.clients c on mrl.client_id = c.id
      left join db.jurisdictions j on mrl.jurisdiction_id = j.id
      left join db.orders o on mrl.order_id = o.id
      where case ui.filter_resolved
        when 'all' then true
        when 'resolved' then mrl.is_resolved = true
        when 'unresolved' then mrl.is_resolved = false
        else true
      end
      order by mrl.lookup_timestamp desc
      `,
        );

        // Group missing rates by combination
        s.defTable(
          "missing_rate_summary",
          sql`
      with grouped_rates as (
        select
          mrl.client_id,
          c.name as client_name,
          mrl.jurisdiction_id,
          j.name as jurisdiction_name,
          mrl.search_type,
          count(*) as total_occurrences,
          min(mrl.lookup_timestamp) as first_occurred,
          max(mrl.lookup_timestamp) as last_occurred,
          min(cast(mrl.is_resolved as int)) = 1 as all_resolved,
          count(case when not mrl.is_resolved then 1 end) as unresolved_count
        from db.missing_rates_log mrl
        left join db.clients c on mrl.client_id = c.id
        left join db.jurisdictions j on mrl.jurisdiction_id = j.id
        group by mrl.client_id, c.name, mrl.jurisdiction_id, j.name, mrl.search_type
      )
      select * from grouped_rates
      where unresolved_count > 0
      order by total_occurrences desc
      `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Missing Rates</Typography>
          <div className="flex gap-2">
            <Select
              value={sql`filter_resolved`}
              onChange={(s) =>
                s.setScalar("filter_resolved", sql`target_value`)}
              variant="outlined"
              size="sm"
            >
              <Select.Option value="unresolved">
                Unresolved Only
              </Select.Option>
              <Select.Option value="resolved">Resolved Only</Select.Option>
              <Select.Option value="all">All</Select.Option>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Total Missing Rates
            </Typography>
            <Typography level="title-lg">
              {sql`(select count(*) from missing_rate_summary)`}
            </Typography>
          </Card>
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Unresolved
            </Typography>
            <Typography level="title-lg" className="text-danger-600">
              {sql`(select count(*) from missing_rate_summary where unresolved_count > 0)`}
            </Typography>
          </Card>
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Affected Orders
            </Typography>
            <Typography level="title-lg">
              {sql`affected_orders_count`}
            </Typography>
          </Card>
        </div>

        {/* Missing Rate Summary */}
        <Show when={sql`filter_resolved = 'unresolved'`}>
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Unresolved Missing Rates Summary
            </Typography>
            <Table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Jurisdiction</th>
                  <th>Search Type</th>
                  <th>Occurrences</th>
                  <th>First Seen</th>
                  <th>Last Seen</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <Each table="missing_rate_summary" recordName="summary">
                  <tr>
                    <td>{sql`summary.client_name`}</td>
                    <td>{sql`summary.jurisdiction_name`}</td>
                    <td>{sql`summary.search_type`}</td>
                    <td>
                      <Chip size="sm" variant="soft" color="warning">
                        {sql`summary.unresolved_count`} unresolved
                      </Chip>
                    </td>
                    <td>
                      {sql`format.date(summary.first_occurred, '%Y-%m-%d')`}
                    </td>
                    <td>
                      {sql`format.date(summary.last_occurred, '%Y-%m-%d')`}
                    </td>
                    <td>
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={(s) => {
                          s.setScalar("fix_rate_modal_open", sql.true);
                          s.server((s) => {
                            s.setScalar(
                              "selected_missing_rate_id",
                              sql`(
                            select id from db.missing_rates_log
                            where client_id = summary.client_id
                              and jurisdiction_id = summary.jurisdiction_id
                              and search_type = summary.search_type
                              and not is_resolved
                            limit 1
                          )`,
                            );
                          });
                        }}
                      >
                        Fix Rate
                      </Button>
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>
        </Show>

        {/* Detailed Missing Rates Log */}
        <Card className="p-4">
          <Typography level="title-md" className="mb-4">
            Missing Rates Log
          </Typography>
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Jurisdiction</th>
                <th>Search Type</th>
                <th>Order Reference</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <Each table="missing_rates" recordName="rate">
                <tr>
                  <td>
                    {sql`format.date(rate.occurred_at, '%Y-%m-%d %H:%M')`}
                  </td>
                  <td>{sql`rate.client_name`}</td>
                  <td>{sql`rate.jurisdiction_name`}</td>
                  <td>{sql`rate.search_type`}</td>
                  <td>{sql`coalesce(rate.order_reference, 'N/A')`}</td>
                  <td>
                    <Show when={sql`rate.is_resolved`}>
                      <Chip size="sm" variant="soft" color="success">
                        Resolved
                      </Chip>
                    </Show>
                    <Show when={sql`not rate.is_resolved`}>
                      <Chip size="sm" variant="soft" color="warning">
                        Missing
                      </Chip>
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>

        {/* Fix Rate Modal */}
        <ModalDialog
          open={sql`fix_rate_modal_open`}
          onClose={(s) => s.setScalar("fix_rate_modal_open", sql.false)}
          title="Fix Missing Rate"
        >
          <div className="flex flex-col gap-4 p-4">
            <Typography level="body-md">
              Add a rate to resolve this missing rate issue.
            </Typography>

            <FormControl fullWidth>
              <FormLabel>Rate Type</FormLabel>
              <EnumSelect
                enum="order_expense_type"
                value={sql`fix_rate_type`}
                onChange={(s) =>
                  s.setScalar("fix_rate_type", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Rate Amount</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`fix_rate_amount`}
                onInput={(s) =>
                  s.setScalar("fix_rate_amount", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="0.00"
              />
            </FormControl>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("fix_rate_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => fixMissingRate(s)}
                disabled={sql`fix_rate_amount <= 0`}
              >
                Create Rate
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}

export function ClientRatesManager() {
  const saveRate = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.if(sql`edit_rate_id is not null`, (s) => {
          // Update existing rate
          s.modify(sql`
            update db.client_rates
            set
              jurisdiction_id = ui.form_jurisdiction_id,
              search_type = ui.form_search_type,
              rate_type = ui.form_rate_type,
              amount = ui.form_amount,
              effective_from = ui.form_effective_from
            where id = ui.edit_rate_id
          `);
        });

        s.if(sql`edit_rate_id is null`, (s) => {
          // Deactivate existing rate if exists
          s.modify(sql`
            update db.client_rates
            set is_active = false
            where client_id = ui.selected_client_id
              and coalesce(jurisdiction_id, 0) = coalesce(ui.form_jurisdiction_id, 0)
              and (search_type = ui.form_search_type or (search_type is null and ui.form_search_type is null))
              and rate_type = ui.form_rate_type
              and is_active
          `);

          // Insert new rate
          s.modify(sql`
            insert into db.client_rates (
              client_id,
              jurisdiction_id,
              search_type,
              rate_type,
              amount,
              effective_from,
              is_active
            ) values (
              ui.selected_client_id,
              ui.form_jurisdiction_id,
              ui.form_search_type,
              ui.form_rate_type,
              ui.form_amount,
              ui.form_effective_from,
              true
            )
          `);
        });

        s.commitTransaction();
        s.setScalar("rate_modal_open", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_client_id", sql.null);
        s.defScalar("rate_modal_open", sql.false);
        s.defScalar("edit_rate_id", sql.null);

        // Form fields
        s.defScalar("form_jurisdiction_id", sql.null);
        s.defScalar("form_search_type", {
          type: { type: "Enum", enum: "search_type" },
        });
        s.defScalar(
          "form_rate_type",
          sql`'search_fee'::enums.order_expense_type`,
        );
        s.defScalar("form_amount", sql`0`);
        s.defScalar("form_effective_from", sql`current_date()`);

        // Clients list
        s.defTable(
          "clients",
          sql`
      select
        c.id,
        c.name,
        c.code,
        c.type,
        count(distinct cr.id) as rate_count,
        avg(cr.amount) as avg_rate,
        count(distinct o.id) as recent_orders
      from db.clients c
      left join db.client_rates cr on c.id = cr.client_id and cr.is_active
      left join db.orders o on c.id = o.client_id
        and o.created_at >= current_date() - interval '30 days'
      where c.is_active
      group by c.id, c.name, c.code, c.type
      order by c.name
      `,
        );

        // Rates for selected client
        s.defTable(
          "client_rates",
          sql`
      select
        cr.id,
        cr.jurisdiction_id,
        j.name as jurisdiction_name,
        cr.search_type,
        cr.rate_type,
        cr.amount,
        cr.effective_from,
        cr.is_active
      from db.client_rates cr
      left join db.jurisdictions j on cr.jurisdiction_id = j.id
      where cr.client_id = ui.selected_client_id
        and cr.is_active
      order by j.name, cr.search_type, cr.rate_type
      `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Client Rates Manager</Typography>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Clients List */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">Clients</Typography>
            <div className="overflow-y-auto max-h-[600px]">
              <Each table="clients" recordName="client">
                <div
                  dynamicClasses={[
                    {
                      classes:
                        "p-3 cursor-pointer rounded bg-primary-soft border border-primary-outlined mb-2",
                      condition: sql`selected_client_id = client.id`,
                    },
                    {
                      classes:
                        "p-3 cursor-pointer rounded hover:bg-surface border border-divider mb-2",
                      condition: sql`selected_client_id != client.id`,
                    },
                  ]}
                  onClick={(s) =>
                    s.setScalar("selected_client_id", sql`client.id`)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <Typography level="body-md" className="font-semibold">
                        {sql`client.name`}
                      </Typography>
                      <Typography level="body-sm" className="text-secondary">
                        {sql`client.code`} • Type: {sql`client.type`}
                      </Typography>
                    </div>
                    <div className="text-right">
                      <Typography level="body-xs" className="text-secondary">
                        {sql`client.rate_count`} rates
                      </Typography>
                      <Typography level="body-xs" className="text-secondary">
                        {sql`client.recent_orders`} recent orders
                      </Typography>
                    </div>
                  </div>
                </div>
              </Each>
            </div>
          </Card>

          {/* Client Rates */}
          <Card className="lg:col-span-2 p-4">
            <Show when={sql`selected_client_id is not null`}>
              <div className="flex justify-between items-center mb-4">
                <Typography level="title-md">
                  Client Rate Configuration
                </Typography>
                <Button
                  variant="solid"
                  color="primary"
                  size="sm"
                  onClick={(s) => {
                    s.setScalar("rate_modal_open", sql.true);
                    s.setScalar("edit_rate_id", sql.null);
                    s.setScalar("form_jurisdiction_id", sql.null);
                    s.setScalar("form_search_type", sql.null);
                    s.setScalar(
                      "form_rate_type",
                      sql`'search_fee'::enums.order_expense_type`,
                    );
                    s.setScalar("form_amount", sql`0`);
                    s.setScalar("form_effective_from", sql`current_date()`);
                  }}
                >
                  <MaterialIcon icon="Add" className="mr-1" />
                  Add Rate
                </Button>
              </div>

              <Table>
                <thead>
                  <tr>
                    <th>Jurisdiction</th>
                    <th>Search Type</th>
                    <th>Rate Type</th>
                    <th>Amount</th>
                    <th>Effective From</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <Each table="client_rates" recordName="rate">
                    <tr>
                      <td>
                        {sql`coalesce(rate.jurisdiction_name, 'All Jurisdictions')`}
                      </td>
                      <td>
                        {sql`coalesce(rate.search_type::string, 'All Types')`}
                      </td>
                      <td>{sql`rate.rate_type`}</td>
                      <td>{sql`format.currency(rate.amount, 'USD')`}</td>
                      <td>
                        {sql`format.date(rate.effective_from, '%Y-%m-%d')`}
                      </td>
                      <td>
                        <IconButton
                          variant="plain"
                          size="sm"
                          onClick={(s) => {
                            s.setScalar("rate_modal_open", sql.true);
                            s.setScalar("edit_rate_id", sql`rate.id`);
                            s.setScalar(
                              "form_jurisdiction_id",
                              sql`rate.jurisdiction_id`,
                            );
                            s.setScalar(
                              "form_search_type",
                              sql`rate.search_type`,
                            );
                            s.setScalar("form_rate_type", sql`rate.rate_type`);
                            s.setScalar("form_amount", sql`rate.amount`);
                            s.setScalar(
                              "form_effective_from",
                              sql`rate.effective_from`,
                            );
                          }}
                        >
                          <MaterialIcon icon="Edit" />
                        </IconButton>
                      </td>
                    </tr>
                  </Each>
                </tbody>
              </Table>
            </Show>

            <Show when={sql`selected_client_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Group"
                  className="text-6xl text-tertiary mb-4"
                />
                <Typography level="body-lg" className="text-tertiary">
                  Select a client to manage rates
                </Typography>
              </div>
            </Show>
          </Card>
        </div>

        {/* Rate Modal */}
        <ModalDialog
          open={sql`rate_modal_open`}
          onClose={(s) => s.setScalar("rate_modal_open", sql.false)}
          title={sql`case when edit_rate_id is not null then 'Edit Rate' else 'Add Rate' end`}
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
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
                  value={sql`form_jurisdiction_id`}
                  onChange={(s, recordId) => {
                    s.setScalar("form_jurisdiction_id", sql`${recordId}`);
                  }}
                  variant="outlined"
                  fullWidth
                  optionLabel="name"
                  optionValue="id"
                  placeholder="All Jurisdictions"
                />
              </Data>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Search Type</FormLabel>
              <EnumSelect
                enum="search_type"
                value={sql`form_search_type`}
                onChange={(s) =>
                  s.setScalar("form_search_type", sql`target_value`)}
                variant="outlined"
                fullWidth
                nullVariant="All Search Types"
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Rate Type</FormLabel>
              <EnumSelect
                enum="order_expense_type"
                value={sql`form_rate_type`}
                onChange={(s) =>
                  s.setScalar("form_rate_type", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Amount</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_amount`}
                onInput={(s) => s.setScalar("form_amount", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="0.00"
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Effective From</FormLabel>
              <Input
                type="date"
                value={sql`form_effective_from`}
                onInput={(s) =>
                  s.setScalar("form_effective_from", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("rate_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => saveRate(s)}
                disabled={sql`form_amount <= 0`}
              >
                Save Rate
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}

export function DefaultRatesManager() {
  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_jurisdiction_id", sql.null);

        s.defScalar("selected_search_type", {
          type: { type: "Enum", enum: "search_type" },
        });
        s.defScalar("edit_modal_open", sql.false);
        s.defScalar("edit_rate_id", sql.null);

        s.defTable(
          "default_rates",
          sql`
      select
        cr.id,
        cr.jurisdiction_id,
        j.name as jurisdiction_name,
        cr.search_type,
        cr.rate_type,
        cr.amount,
        cr.effective_from,
        cr.effective_to
      from db.client_rates cr
      left join db.jurisdictions j on cr.jurisdiction_id = j.id
      where cr.client_id is null
        and cr.is_active
        and (selected_jurisdiction_id is null or cr.jurisdiction_id = selected_jurisdiction_id)
        and (selected_search_type is null or cr.search_type = selected_search_type)
      order by j.name, cr.search_type, cr.rate_type
    `,
        );

        s.defScalar("form_jurisdiction_id", sql.null);
        s.defScalar("form_search_type", {
          type: { type: "Enum", enum: "search_type" },
        });
        s.defScalar("form_rate_type", {
          type: { type: "Enum", enum: "order_expense_type" },
        });
        s.defScalar("form_amount", sql`0`);
        s.defScalar("form_effective_from", sql`current_date()`);
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Default Rates Manager</Typography>
          <Button
            variant="solid"
            color="primary"
            onClick={(s) => {
              s.setScalar("edit_modal_open", sql.true);
              s.setScalar("edit_rate_id", sql.null);
              s.setScalar("form_jurisdiction_id", sql.null);
              s.setScalar("form_search_type", sql.null);
              s.setScalar("form_rate_type", sql.null);
              s.setScalar("form_amount", sql`0`);
              s.setScalar("form_effective_from", sql`current_date()`);
            }}
          >
            Add Default Rate
          </Button>
        </div>

        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <FormControl fullWidth>
                <FormLabel>Filter by Jurisdiction</FormLabel>
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
                    onChange={(s, recordId) => {
                      s.setScalar("selected_jurisdiction_id", sql`${recordId}`);
                    }}
                    variant="outlined"
                    fullWidth
                    optionLabel="name"
                    optionValue="id"
                    placeholder="All Jurisdictions"
                  />
                </Data>
              </FormControl>
            </div>
            <div>
              <FormControl fullWidth>
                <FormLabel>Filter by Search Type</FormLabel>
                <EnumSelect
                  enum="search_type"
                  value={sql`selected_search_type`}
                  onChange={(s) =>
                    s.setScalar("selected_search_type", sql`target_value`)}
                  variant="outlined"
                  fullWidth
                  nullVariant="All Search Types"
                />
              </FormControl>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Jurisdiction</th>
                <th>Search Type</th>
                <th>Rate Type</th>
                <th>Amount</th>
                <th>Effective From</th>
                <th>Effective To</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <Each table="default_rates" recordName="rate">
                <tr>
                  <td>{sql`coalesce(rate.jurisdiction_name, 'All')`}</td>
                  <td>{sql`coalesce(rate.search_type::string, 'All')`}</td>
                  <td>{sql`rate.rate_type`}</td>
                  <td>{sql`format.currency(rate.amount, 'USD')`}</td>
                  <td>{sql`format.date(rate.effective_from, '%Y-%m-%d')`}</td>
                  <td>
                    {sql`case when rate.effective_to is null then 'Active' else format.date(rate.effective_to, '%Y-%m-%d') end`}
                  </td>
                  <td>
                    <IconButton
                      variant="plain"
                      size="sm"
                      onClick={(s) => {
                        s.setScalar("edit_modal_open", sql.true);
                        s.setScalar("edit_rate_id", sql`rate.id`);
                        s.setScalar(
                          "form_jurisdiction_id",
                          sql`rate.jurisdiction_id`,
                        );
                        s.setScalar("form_search_type", sql`rate.search_type`);
                        s.setScalar("form_rate_type", sql`rate.rate_type`);
                        s.setScalar("form_amount", sql`rate.amount`);
                        s.setScalar(
                          "form_effective_from",
                          sql`rate.effective_from`,
                        );
                      }}
                    >
                      <MaterialIcon icon="Edit" />
                    </IconButton>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>

        <ModalDialog
          open={sql`edit_modal_open`}
          onClose={(s) => s.setScalar("edit_modal_open", sql.false)}
          title={sql`case when edit_rate_id is not null then 'Edit Default Rate' else 'Add Default Rate' end`}
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
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
                  value={sql`form_jurisdiction_id`}
                  onChange={(s, recordId) => {
                    s.setScalar("form_jurisdiction_id", sql`${recordId}`);
                  }}
                  variant="outlined"
                  fullWidth
                  optionLabel="name"
                  optionValue="id"
                  placeholder="All Jurisdictions"
                />
              </Data>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Search Type</FormLabel>
              <EnumSelect
                enum="search_type"
                value={sql`form_search_type`}
                onChange={(s) =>
                  s.setScalar("form_search_type", sql`target_value`)}
                variant="outlined"
                fullWidth
                nullVariant="All Search Types"
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Rate Type</FormLabel>
              <EnumSelect
                enum="order_expense_type"
                value={sql`form_rate_type`}
                onChange={(s) =>
                  s.setScalar("form_rate_type", sql`target_value`)}
                variant="outlined"
                fullWidth
                nullVariant="Select Rate Type"
              />
            </FormControl>
            <FormControl fullWidth>
              <FormLabel>Amount</FormLabel>
              <Input
                type="number"
                value={sql`form_amount`}
                onInput={(s) => s.setScalar("form_amount", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Effective From</FormLabel>
              <Input
                type="date"
                value={sql`form_effective_from`}
                onInput={(s) =>
                  s.setScalar("form_effective_from", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("edit_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => {
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      s.if(sql`edit_rate_id is not null`, (s) => {
                        // Update existing rate
                        s.modify(sql`
                        update db.client_rates
                        set
                          jurisdiction_id = ui.form_jurisdiction_id,
                          search_type = ui.form_search_type,
                          rate_type = ui.form_rate_type,
                          amount = ui.form_amount,
                          effective_from = ui.form_effective_from
                        where id = ui.edit_rate_id
                      `);
                      });
                      s.if(sql`edit_rate_id is null`, (s) => {
                        // Insert new rate
                        s.modify(sql`
                        insert into db.client_rates (
                          client_id,
                          jurisdiction_id,
                          search_type,
                          rate_type,
                          amount,
                          effective_from,
                          is_active
                        ) values (
                          null,
                          ui.form_jurisdiction_id,
                          ui.form_search_type,
                          ui.form_rate_type,
                          ui.form_amount,
                          ui.form_effective_from,
                          true
                        )
                      `);
                      });
                      s.commitTransaction();
                    },
                    finally: (s) => {
                      s.setScalar("edit_modal_open", sql.false);
                    },
                  });
                }}
                disabled={sql`form_amount <= 0 or form_rate_type is null`}
              >
                Save
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}
