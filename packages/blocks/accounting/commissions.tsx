import { type Sql, sql } from "std/sql_utils";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
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
import { Checkbox } from "components/checkbox";
import { Textarea } from "components/textarea";
import { Divider } from "components/divider";
import type { DomStatements } from "std/statements";

export function CommissionStructureManager() {
  const saveStructure = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.if(sql`edit_structure_id is null`, (s) => {
          // Insert new structure
          s.modify(sql`
            insert into db.commission_structures (
              name,
              description,
              type,
              base_rate,
              minimum_threshold,
              cap_amount,
              created_by
            ) values (
              ui.form_name,
              case when ui.form_description = '' then null else ui.form_description end,
              ui.form_type,
              case when ui.form_base_rate = 0 then null else ui.form_base_rate end,
              case when ui.form_minimum_threshold = 0 then null else ui.form_minimum_threshold end,
              ui.form_cap_amount,
              current_user
            )
          `);
        });

        s.if(sql`edit_structure_id is not null`, (s) => {
          // Update existing structure
          s.modify(sql`
            update db.commission_structures
            set
              name = ui.form_name,
              description = case when ui.form_description = '' then null else ui.form_description end,
              type = ui.form_type,
              base_rate = case when ui.form_base_rate = 0 then null else ui.form_base_rate end,
              minimum_threshold = case when ui.form_minimum_threshold = 0 then null else ui.form_minimum_threshold end,
              cap_amount = ui.form_cap_amount
            where id = ui.edit_structure_id
          `);
        });

        s.commitTransaction();
        s.refetch();
      },
      finally: (s) => {
        s.setScalar("structure_modal_open", sql.false);
        s.setScalar("edit_structure_id", sql.null);
        // Reset form
        s.setScalar("form_name", sql.lit``);
        s.setScalar("form_description", sql.lit``);
        s.setScalar("form_type", sql.lit`flat_rate`);
        s.setScalar("form_base_rate", sql`0`);
        s.setScalar("form_minimum_threshold", sql`0`);
        s.setScalar("form_cap_amount", sql.null);
      },
    });
  };

  const addTier = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.modify(sql`
          insert into db.commission_tiers (
            structure_id,
            min_amount,
            max_amount,
            rate,
            description
          ) values (
            ui.selected_structure_id,
            ui.form_tier_min,
            ui.form_tier_max,
            ui.form_tier_rate,
            case when ui.form_tier_description = '' then null else ui.form_tier_description end
          )
        `);

        s.commitTransaction();
        s.refetch();
      },
      finally: (s) => {
        s.setScalar("tier_modal_open", sql.false);
        // Reset form
        s.setScalar("form_tier_min", sql`0`);
        s.setScalar("form_tier_max", sql.null);
        s.setScalar("form_tier_rate", sql`0`);
        s.setScalar("form_tier_description", sql.lit``);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("structure_modal_open", sql.false);
        s.defScalar("edit_structure_id", sql.null);
        s.defScalar("tier_modal_open", sql.false);
        s.defScalar("selected_structure_id", sql.null);

        // Form fields
        s.defScalar("form_name", sql.lit``);
        s.defScalar("form_description", sql.lit``);
        s.defScalar("form_type", sql.lit`flat_rate`);
        s.defScalar("form_base_rate", sql`0`);
        s.defScalar("form_minimum_threshold", sql`0`);
        s.defScalar("form_cap_amount", sql.null);

        // Tier form fields
        s.defScalar("form_tier_min", sql`0`);
        s.defScalar("form_tier_max", sql.null);
        s.defScalar("form_tier_rate", sql`0`);
        s.defScalar("form_tier_description", sql.lit``);

        // Get commission structures
        s.defTable(
          "structures",
          sql`
          select
            cs.id,
            cs.name,
            cs.description,
            cs.type,
            cs.base_rate,
            cs.minimum_threshold,
            cs.cap_amount,
            cs.is_active,
            count(distinct ec.employee_id) as employee_count,
            count(distinct ct.id) as tier_count
          from db.commission_structures cs
          left join db.employee_commissions ec on cs.id = ec.structure_id and ec.is_active
          left join db.commission_tiers ct on cs.id = ct.structure_id
          group by cs.id, cs.name, cs.description, cs.type, cs.base_rate,
                   cs.minimum_threshold, cs.cap_amount, cs.is_active
          order by cs.name
        `,
        );

        // Get tiers for selected structure
        s.defTable(
          "structure_tiers",
          sql`
          select
            id,
            min_amount,
            max_amount,
            rate,
            description
          from db.commission_tiers
          where structure_id = ui.selected_structure_id
          order by min_amount
        `,
        );

        // When editing, populate form fields
        s.if(sql`edit_structure_id is not null`, (s) => {
          s.defRecord(
            "edit_structure",
            sql`select * from db.commission_structures where id = ui.edit_structure_id`,
          );
          s.setScalar("form_name", sql`edit_structure.name`);
          s.setScalar(
            "form_description",
            sql`coalesce(edit_structure.description, '')`,
          );
          s.setScalar("form_type", sql`edit_structure.type`);
          s.setScalar(
            "form_base_rate",
            sql`coalesce(edit_structure.base_rate, 0)`,
          );
          s.setScalar(
            "form_minimum_threshold",
            sql`coalesce(edit_structure.minimum_threshold, 0)`,
          );
          s.setScalar("form_cap_amount", sql`edit_structure.cap_amount`);
        });
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Commission Structures</Typography>
          <Button
            variant="solid"
            color="primary"
            onClick={(s) => {
              s.setScalar("structure_modal_open", sql.true);
              s.setScalar("edit_structure_id", sql.null);
            }}
          >
            <MaterialIcon icon="Add" className="mr-1" />
            New Structure
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Structure List */}
          <Card className="lg:col-span-2 p-4">
            <Table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Base Rate</th>
                  <th>Threshold</th>
                  <th>Cap</th>
                  <th>Employees</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <Each table="structures" recordName="structure">
                  <tr
                    dynamicClasses={[
                      {
                        classes: "bg-primary-50",
                        condition: sql`selected_structure_id = structure.id`,
                      },
                    ]}
                    className="cursor-pointer hover:bg-surface"
                    onClick={(s) =>
                      s.setScalar("selected_structure_id", sql`structure.id`)}
                  >
                    <td>
                      <Typography level="body-md" className="font-semibold">
                        {sql`structure.name`}
                      </Typography>
                      <Show when={sql`structure.description is not null`}>
                        <Typography level="body-sm" className="text-secondary">
                          {sql`structure.description`}
                        </Typography>
                      </Show>
                    </td>
                    <td>
                      <Chip size="sm" variant="soft" color="primary">
                        {sql`structure.type`}
                      </Chip>
                    </td>
                    <td>
                      <Show when={sql`structure.base_rate is not null`}>
                        {sql`structure.base_rate`}%
                      </Show>
                      <Show when={sql`structure.base_rate is null`}>
                        <Typography level="body-sm" className="text-tertiary">
                          -
                        </Typography>
                      </Show>
                    </td>
                    <td>
                      <Show when={sql`structure.minimum_threshold is not null`}>
                        {sql`format.currency(structure.minimum_threshold, 'USD')`}
                      </Show>
                      <Show when={sql`structure.minimum_threshold is null`}>
                        <Typography level="body-sm" className="text-tertiary">
                          -
                        </Typography>
                      </Show>
                    </td>
                    <td>
                      <Show when={sql`structure.cap_amount is not null`}>
                        {sql`format.currency(structure.cap_amount, 'USD')`}
                      </Show>
                      <Show when={sql`structure.cap_amount is null`}>
                        <Typography level="body-sm" className="text-tertiary">
                          No cap
                        </Typography>
                      </Show>
                    </td>
                    <td>{sql`structure.employee_count`}</td>
                    <td>
                      <Show when={sql`structure.is_active`}>
                        <Chip size="sm" variant="soft" color="success">
                          Active
                        </Chip>
                      </Show>
                      <Show when={sql`not structure.is_active`}>
                        <Chip size="sm" variant="soft" color="neutral">
                          Inactive
                        </Chip>
                      </Show>
                    </td>
                    <td>
                      <IconButton
                        variant="plain"
                        size="sm"
                        onClick={(s) => {
                          s.setScalar("edit_structure_id", sql`structure.id`);
                          s.setScalar("structure_modal_open", sql.true);
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

          {/* Tier Details */}
          <Card className="p-4">
            <Show when={sql`selected_structure_id is not null`}>
              <div className="flex justify-between items-center mb-4">
                <Typography level="title-md">Commission Tiers</Typography>
                <Show
                  when={sql`(select type from structures where id = selected_structure_id) = 'tiered'`}
                >
                  <Button
                    variant="outlined"
                    size="sm"
                    onClick={(s) => s.setScalar("tier_modal_open", sql.true)}
                  >
                    Add Tier
                  </Button>
                </Show>
              </div>

              <Show
                when={sql`(select tier_count from structures where id = selected_structure_id) > 0`}
              >
                <div className="space-y-2">
                  <Each table="structure_tiers" recordName="tier">
                    <div className="p-3 bg-surface rounded">
                      <div className="flex justify-between items-start">
                        <div>
                          <Typography
                            level="body-sm"
                            className="text-secondary"
                          >
                            {sql`format.currency(tier.min_amount, 'USD')`} -
                            <Show when={sql`tier.max_amount is not null`}>
                              {sql`' ' || format.currency(tier.max_amount, 'USD')`}
                            </Show>
                            <Show when={sql`tier.max_amount is null`}>
                              {sql`' ∞'`}
                            </Show>
                          </Typography>
                          <Typography level="body-md" className="font-semibold">
                            {sql`tier.rate`}%
                          </Typography>
                          <Show when={sql`tier.description is not null`}>
                            <Typography
                              level="body-sm"
                              className="text-secondary"
                            >
                              {sql`tier.description`}
                            </Typography>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </Each>
                </div>
              </Show>
              <Show
                when={sql`(select tier_count from structures where id = selected_structure_id) = 0`}
              >
                <Typography
                  level="body-sm"
                  className="text-tertiary text-center py-4"
                >
                  No tiers defined
                </Typography>
              </Show>
            </Show>
            <Show when={sql`selected_structure_id is null`}>
              <Typography
                level="body-sm"
                className="text-tertiary text-center py-8"
              >
                Select a structure to view details
              </Typography>
            </Show>
          </Card>
        </div>

        {/* Structure Modal */}
        <ModalDialog
          open={sql`structure_modal_open`}
          onClose={(s) => s.setScalar("structure_modal_open", sql.false)}
          title={sql`case when edit_structure_id is null then 'New Commission Structure' else 'Edit Commission Structure' end`}
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Name</FormLabel>
              <Input
                value={sql`form_name`}
                onInput={(s) => s.setScalar("form_name", sql`target_value`)}
                variant="outlined"
                fullWidth
                required
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Description</FormLabel>
              <Textarea
                value={sql`form_description`}
                onChange={(s) =>
                  s.setScalar("form_description", sql`target_value`)}
                rows={3}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Type</FormLabel>
              <Select
                value={sql`form_type`}
                onChange={(s) => s.setScalar("form_type", sql`target_value`)}
                variant="outlined"
                fullWidth
              >
                <Select.Option value="flat_rate">Flat Rate</Select.Option>
                <Select.Option value="tiered">Tiered</Select.Option>
                <Select.Option value="sliding_scale">
                  Sliding Scale
                </Select.Option>
                <Select.Option value="revenue_share">
                  Revenue Share
                </Select.Option>
                <Select.Option value="hybrid">Hybrid</Select.Option>
              </Select>
            </FormControl>

            <Show
              when={sql`form_type = 'flat_rate' or form_type = 'revenue_share'`}
            >
              <FormControl fullWidth>
                <FormLabel>Base Rate (%)</FormLabel>
                <Input
                  type="number"
                  step="0.01"
                  value={sql`form_base_rate`}
                  onInput={(s) =>
                    s.setScalar("form_base_rate", sql`target_value`)}
                  variant="outlined"
                  fullWidth
                />
              </FormControl>
            </Show>

            <FormControl fullWidth>
              <FormLabel>Minimum Threshold</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_minimum_threshold`}
                onInput={(s) =>
                  s.setScalar("form_minimum_threshold", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Cap Amount (leave empty for no cap)</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_cap_amount`}
                onInput={(s) =>
                  s.setScalar(
                    "form_cap_amount",
                    sql`case when target_value = '' then null else target_value end`,
                  )}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("structure_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => saveStructure(s)}
                disabled={sql`form_name = ''`}
              >
                Save
              </Button>
            </div>
          </div>
        </ModalDialog>

        {/* Tier Modal */}
        <ModalDialog
          open={sql`tier_modal_open`}
          onClose={(s) => s.setScalar("tier_modal_open", sql.false)}
          title="Add Commission Tier"
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Minimum Amount</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_tier_min`}
                onInput={(s) => s.setScalar("form_tier_min", sql`target_value`)}
                variant="outlined"
                fullWidth
                required
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Maximum Amount (leave empty for no max)</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_tier_max`}
                onInput={(s) =>
                  s.setScalar(
                    "form_tier_max",
                    sql`case when target_value = '' then null else target_value end`,
                  )}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Rate (%)</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_tier_rate`}
                onInput={(s) =>
                  s.setScalar("form_tier_rate", sql`target_value`)}
                variant="outlined"
                fullWidth
                required
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Description</FormLabel>
              <Input
                value={sql`form_tier_description`}
                onInput={(s) =>
                  s.setScalar("form_tier_description", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("tier_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => addTier(s)}
              >
                Add Tier
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}

export function CommissionCalculator() {
  const calculateCommission = (s: DomStatements) => {
    s.setScalar("calculating", sql.true);
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Get period dates
        s.defScalar(
          "calculation_period_start",
          sql`
          case ui.selected_period
            when 'current_month' then date_trunc('month', current_date())
            when 'last_month' then date_trunc('month', current_date() - interval '1 month')
            when 'current_quarter' then date_trunc('quarter', current_date())
            else current_date()
          end
        `,
        );

        s.defScalar(
          "calculation_period_end",
          sql`
          case ui.selected_period
            when 'current_month' then date_trunc('month', current_date()) + interval '1 month' - interval '1 day'
            when 'last_month' then date_trunc('month', current_date()) - interval '1 day'
            when 'current_quarter' then date_trunc('quarter', current_date()) + interval '3 months' - interval '1 day'
            else current_date()
          end
        `,
        );

        // Check if calculation already exists
        s.defScalar(
          "existing_calc_id",
          sql`
          (select calculation.id
           from db.commission_calculations as calculation
           where calculation.employee_id = ui.selected_employee_id
             and calculation.period_start = calculation_period_start
             and calculation.period_end = calculation_period_end)
        `,
        );

        // Delete existing if found
        s.if(sql`existing_calc_id is not null`, (s) => {
          s.modify(sql`
            delete from db.commission_details
            where calculation_id = existing_calc_id
          `);

          s.modify(sql`
            delete from db.commission_calculations
            where id = existing_calc_id
          `);
        });

        // Insert new calculation
        s.modify(sql`
          insert into db.commission_calculations (
            employee_id,
            period_start,
            period_end,
            gross_sales,
            commissionable_amount,
            commission_rate,
            commission_amount,
            final_amount,
            calculated_by
          ) values (
            ui.selected_employee_id,
            calculation_period_start,
            calculation_period_end,
            coalesce(ui.commissionable_sales, 0),
            coalesce(ui.commissionable_sales, 0),
            coalesce(ui.effective_rate, 0),
            coalesce(ui.commission_amount, 0),
            coalesce(ui.commission_amount, 0),
            current_user
          )
        `);

        s.defScalar(
          "new_calc_id",
          sql`last_record_id(db.commission_calculations)`,
        );

        // Insert calculation details
        s.modify(sql`
          insert into db.commission_details (
            calculation_id,
            order_id,
            invoice_id,
            amount,
            rate,
            commission,
            description
          )
          select
            new_calc_id,
            o.id,
            i.id,
            i.total_amount,
            ui.effective_rate,
            i.total_amount * ui.effective_rate / 100,
            'Order ' || o.order_number || ' - ' || c.name
          from db.orders o
          join db.ar_invoices i on o.invoice_id = i.id
          join db.clients c on o.client_id = c.id
          where o.sales_rep_id = ui.selected_employee_id
            and i.status = 'paid'
            and o.completed_at between calculation_period_start and calculation_period_end
        `);

        s.commitTransaction();
        s.refetch();
      },
      finally: (s) => {
        s.setScalar("calculating", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_period", sql.lit`current_month`);
        s.defScalar("selected_employee_id", sql.null);
        s.defScalar("show_details", sql.false);
        s.defScalar("calculating", sql.false);

        // Get employees with commission structures
        s.defTable(
          "employees_with_commissions",
          sql`
          select
            e.id,
            e.name,
            e.code,
            e.department,
            cs.name as structure_name,
            cs.type as structure_type,
            ec.override_rate,
            count(distinct o.id) as order_count,
            sum(i.total_amount) as total_sales
          from db.employees e
          join db.employee_commissions ec on e.id = ec.employee_id and ec.is_active
          join db.commission_structures cs on ec.structure_id = cs.id
          left join db.orders o on e.id = o.sales_rep_id
            and case ui.selected_period
              when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
              when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
              when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
              else true
            end
          left join db.ar_invoices i on o.invoice_id = i.id and i.status = 'paid'
          group by e.id, e.name, e.code, e.department, cs.name, cs.type, ec.override_rate
          order by e.name
        `,
        );

        // Get commission calculation for selected employee
        s.if(sql`selected_employee_id is not null`, (s) => {
          s.defRecord(
            "employee_details",
            sql`
            select
              e.id,
              e.name,
              e.code,
              cs.id as structure_id,
              cs.type as structure_type,
              cs.base_rate,
              cs.minimum_threshold,
              cs.cap_amount,
              ec.override_rate
            from db.employees e
            join db.employee_commissions ec on e.id = ec.employee_id and ec.is_active
            join db.commission_structures cs on ec.structure_id = cs.id
            where e.id = ui.selected_employee_id
          `,
          );

          // Calculate commissionable sales
          s.defScalar(
            "commissionable_sales",
            sql`
            (select sum(i.total_amount)
             from db.orders o
             join db.ar_invoices i on o.invoice_id = i.id
             where o.sales_rep_id = ui.selected_employee_id
               and i.status = 'paid'
               and case ui.selected_period
                 when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
                 when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
                 when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
                 else true
               end)
          `,
          );

          // Calculate commission rate based on structure type
          s.defScalar(
            "effective_rate",
            sql`
            case
              when employee_details.override_rate is not null then employee_details.override_rate
              when employee_details.structure_type = 'flat_rate' then employee_details.base_rate
              when employee_details.structure_type = 'tiered' then
                coalesce(
                  (select ct.rate
                   from db.commission_tiers ct
                   where ct.structure_id = employee_details.structure_id
                     and ui.commissionable_sales >= ct.min_amount
                     and (ct.max_amount is null or ui.commissionable_sales <= ct.max_amount)
                   order by ct.min_amount desc
                   limit 1),
                  employee_details.base_rate
                )
              else employee_details.base_rate
            end
          `,
          );

          // Calculate commission amount
          s.defScalar(
            "commission_amount",
            sql`
            case
              when ui.commissionable_sales < employee_details.minimum_threshold then 0
              when employee_details.cap_amount is not null
                and (ui.commissionable_sales * ui.effective_rate / 100) > employee_details.cap_amount
              then employee_details.cap_amount
              else ui.commissionable_sales * ui.effective_rate / 100
            end
          `,
          );

          // Get order details
          s.defTable(
            "commission_orders",
            sql`
            select
              o.order_number,
              o.matter_number,
              c.name as client_name,
              j.name as jurisdiction_name,
              o.search_type,
              i.total_amount,
              o.completed_at,
              i.paid_date
            from db.orders o
            join db.ar_invoices i on o.invoice_id = i.id
            join db.clients c on o.client_id = c.id
            left join db.jurisdictions j on o.jurisdiction_id = j.id
            where o.sales_rep_id = ui.selected_employee_id
              and i.status = 'paid'
              and case ui.selected_period
                when 'current_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date())
                when 'last_month' then date_trunc('month', o.completed_at) = date_trunc('month', current_date() - interval '1 month')
                when 'current_quarter' then date_trunc('quarter', o.completed_at) = date_trunc('quarter', current_date())
                else true
              end
            order by o.completed_at desc
          `,
          );
        });
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Commission Calculator</Typography>

        <div className="flex gap-4 items-center">
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
          </Select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Employee List */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Sales Representatives
            </Typography>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              <Each table="employees_with_commissions" recordName="employee">
                <div
                  dynamicClasses={[
                    {
                      classes:
                        "p-3 cursor-pointer rounded bg-primary-soft border border-primary-outlined",
                      condition: sql`selected_employee_id = employee.id`,
                    },
                    {
                      classes:
                        "p-3 cursor-pointer rounded hover:bg-surface border border-divider",
                      condition: sql`selected_employee_id != employee.id`,
                    },
                  ]}
                  onClick={(s) =>
                    s.setScalar("selected_employee_id", sql`employee.id`)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <Typography level="body-md" className="font-semibold">
                        {sql`employee.name`}
                      </Typography>
                      <Typography level="body-sm" className="text-secondary">
                        {sql`employee.structure_name`}
                      </Typography>
                      <Show when={sql`employee.override_rate is not null`}>
                        <Chip size="sm" variant="soft" color="warning">
                          Override: {sql`employee.override_rate`}%
                        </Chip>
                      </Show>
                    </div>
                    <div className="text-right">
                      <Typography level="body-xs" className="text-secondary">
                        Orders: {sql`employee.order_count`}
                      </Typography>
                      <Typography level="body-sm" className="font-semibold">
                        {sql`format.currency(coalesce(employee.total_sales, 0), 'USD')`}
                      </Typography>
                    </div>
                  </div>
                </div>
              </Each>
            </div>
          </Card>

          {/* Commission Calculation */}
          <Card className="lg:col-span-2 p-4">
            <Show when={sql`selected_employee_id is not null`}>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Typography level="title-md">
                    Commission Calculation
                  </Typography>
                  <Button
                    variant="solid"
                    color="primary"
                    onClick={(s) => calculateCommission(s)}
                    disabled={sql`calculating or commissionable_sales is null`}
                  >
                    Calculate Commission
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-surface p-4 rounded">
                    <Typography level="body-sm" className="text-secondary mb-1">
                      Total Sales
                    </Typography>
                    <Typography level="title-md">
                      {sql`format.currency(coalesce(commissionable_sales, 0), 'USD')`}
                    </Typography>
                  </div>

                  <div className="bg-surface p-4 rounded">
                    <Typography level="body-sm" className="text-secondary mb-1">
                      Commission Rate
                    </Typography>
                    <Typography level="title-md">
                      {sql`coalesce(effective_rate, 0)`}%
                    </Typography>
                  </div>

                  <div className="bg-primary-soft p-4 rounded">
                    <Typography
                      level="body-sm"
                      className="text-primary-soft mb-1"
                    >
                      Commission
                    </Typography>
                    <Typography level="title-md" className="text-primary-700">
                      {sql`format.currency(coalesce(commission_amount, 0), 'USD')`}
                    </Typography>
                  </div>
                </div>

                <Divider />

                <div className="flex items-center justify-between">
                  <Typography level="body-md">Order Details</Typography>
                  <Checkbox
                    checked={sql`show_details`}
                    onChange={(s) =>
                      s.setScalar("show_details", sql`not show_details`)}
                  >
                    Show Details
                  </Checkbox>
                </div>

                <Show when={sql`show_details`}>
                  <Table size="sm">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Client</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Completed</th>
                        <th>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Each table="commission_orders" recordName="order">
                        <tr>
                          <td>{sql`order.order_number`}</td>
                          <td>{sql`order.client_name`}</td>
                          <td>{sql`order.search_type`}</td>
                          <td>
                            {sql`format.currency(order.total_amount, 'USD')`}
                          </td>
                          <td>
                            {sql`format.date(order.completed_at, 'MM/dd/yy')`}
                          </td>
                          <td>
                            {sql`format.date(order.paid_date, 'MM/dd/yy')`}
                          </td>
                        </tr>
                      </Each>
                    </tbody>
                  </Table>
                </Show>
              </div>
            </Show>
            <Show when={sql`selected_employee_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Calculate"
                  className="text-6xl text-tertiary mb-4"
                />
                <Typography level="body-lg" className="text-tertiary">
                  Select an employee to calculate commission
                </Typography>
              </div>
            </Show>
          </Card>
        </div>
      </div>
    </Data>
  );
}

export function CommissionPaymentTracking() {
  const approveCommissions = (calculationIds: Sql) => (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.modify(sql`
          update db.commission_calculations
          set
            status = 'approved',
            approved_date = current_date(),
            approved_by = current_user
          where id = any(${calculationIds})
            and status = 'pending'
        `);

        s.commitTransaction();
        s.refetch();
      },
    });
  };

  const recordPayment = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Update commission calculations
        s.modify(sql`
          update db.commission_calculations
          set
            status = 'paid',
            paid_date = current_date(),
            payment_reference = 'COMM-' || to_char(current_date(), 'YYYYMM') || '-' ||
              lpad(cast((select count(*) + 1 from db.commission_calculations where payment_reference like 'COMM-' || to_char(current_date(), 'YYYYMM') || '-%') as string), 4, '0')
          where status = 'approved'
        `);

        // Create journal entries for commission payments
        // (This would be implemented based on the specific accounting requirements)

        s.commitTransaction();
        s.refetch();
      },
      finally: (s) => {
        s.setScalar("payment_modal_open", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("filter_status", sql.lit`pending`);
        s.defScalar("payment_modal_open", sql.false);
        s.defScalar("selected_calculation_ids", sql.lit`[]`);

        // Get commission calculations for payment
        s.defTable(
          "commission_payments",
          sql`
          select
            cc.id,
            cc.employee_id,
            e.name as employee_name,
            e.code as employee_code,
            cc.period_start,
            cc.period_end,
            cc.gross_sales,
            cc.commission_amount,
            cc.adjustments,
            cc.final_amount,
            cc.status,
            cc.approved_date,
            cc.approved_by,
            cc.paid_date,
            cc.payment_reference
          from db.commission_calculations cc
          join db.employees e on cc.employee_id = e.id
          where case ui.filter_status
            when 'pending' then cc.status = 'pending'
            when 'approved' then cc.status = 'approved'
            when 'paid' then cc.status = 'paid'
            else true
          end
          order by cc.period_start desc, e.name
        `,
        );

        // Calculate totals for filtered payments
        s.defScalar(
          "total_pending",
          sql`
          (select sum(final_amount)
           from db.commission_calculations
           where status = 'pending')
        `,
        );

        s.defScalar(
          "total_approved",
          sql`
          (select sum(final_amount)
           from db.commission_calculations
           where status = 'approved')
        `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Commission Payment Tracking</Typography>

        <div className="grid grid-cols-4 gap-4">
          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Pending
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(coalesce(total_pending, 0), 'USD')`}
            </Typography>
          </Card>

          <Card className="p-4">
            <Typography level="body-sm" className="text-secondary">
              Approved
            </Typography>
            <Typography level="title-lg">
              {sql`format.currency(coalesce(total_approved, 0), 'USD')`}
            </Typography>
          </Card>

          <Card className="p-4 col-span-2 flex items-center justify-between">
            <div>
              <Typography level="body-sm" className="text-secondary">
                Payment Actions
              </Typography>
              <Typography level="body-md">
                Process approved commissions
              </Typography>
            </div>
            <Button
              variant="solid"
              color="primary"
              onClick={(s) => s.setScalar("payment_modal_open", sql.true)}
              disabled={sql`total_approved = 0 or total_approved is null`}
            >
              Process Payments
            </Button>
          </Card>
        </div>

        <div className="flex gap-4">
          <Select
            value={sql`filter_status`}
            onChange={(s) => s.setScalar("filter_status", sql`target_value`)}
            variant="outlined"
            size="sm"
          >
            <Select.Option value="all">All Commissions</Select.Option>
            <Select.Option value="pending">Pending</Select.Option>
            <Select.Option value="approved">Approved</Select.Option>
            <Select.Option value="paid">Paid</Select.Option>
          </Select>
        </div>

        <Card className="p-4">
          <Table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Period</th>
                <th>Gross Sales</th>
                <th>Commission</th>
                <th>Adjustments</th>
                <th>Final Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <Each table="commission_payments" recordName="payment">
                <tr>
                  <td>
                    <Typography level="body-md" className="font-semibold">
                      {sql`payment.employee_name`}
                    </Typography>
                    <Typography level="body-sm" className="text-secondary">
                      {sql`payment.employee_code`}
                    </Typography>
                  </td>
                  <td>
                    {sql`format.date(payment.period_start, '%m/%d')`} -
                    {sql`format.date(payment.period_end, '%m/%d/%y')`}
                  </td>
                  <td>{sql`format.currency(payment.gross_sales, 'USD')`}</td>
                  <td>
                    {sql`format.currency(payment.commission_amount, 'USD')`}
                  </td>
                  <td>
                    <Show when={sql`payment.adjustments != 0`}>
                      <Typography
                        level="body-md"
                        dynamicClasses={[
                          {
                            classes: "text-danger-600",
                            condition: sql`payment.adjustments < 0`,
                          },
                          {
                            classes: "text-success-600",
                            condition: sql`payment.adjustments > 0`,
                          },
                        ]}
                      >
                        {sql`format.currency(payment.adjustments, 'USD')`}
                      </Typography>
                    </Show>
                    <Show when={sql`payment.adjustments = 0`}>
                      <Typography level="body-sm" className="text-tertiary">
                        -
                      </Typography>
                    </Show>
                  </td>
                  <td className="font-semibold">
                    {sql`format.currency(payment.final_amount, 'USD')`}
                  </td>
                  <td>
                    <Show when={sql`payment.status = 'pending'`}>
                      <Chip size="sm" variant="soft" color="warning">
                        Pending
                      </Chip>
                    </Show>
                    <Show when={sql`payment.status = 'approved'`}>
                      <Chip size="sm" variant="soft" color="primary">
                        Approved
                      </Chip>
                    </Show>
                    <Show when={sql`payment.status = 'paid'`}>
                      <Chip size="sm" variant="soft" color="success">
                        Paid
                      </Chip>
                    </Show>
                  </td>
                  <td>
                    <Show when={sql`payment.status = 'pending'`}>
                      <Button
                        variant="outlined"
                        size="sm"
                        onClick={approveCommissions(sql`array[payment.id]`)}
                      >
                        Approve
                      </Button>
                    </Show>
                    <Show when={sql`payment.status = 'paid'`}>
                      <Typography level="body-xs" className="text-secondary">
                        {sql`payment.payment_reference`}
                      </Typography>
                    </Show>
                  </td>
                </tr>
              </Each>
            </tbody>
          </Table>
        </Card>

        {/* Payment Processing Modal */}
        <ModalDialog
          open={sql`payment_modal_open`}
          onClose={(s) => s.setScalar("payment_modal_open", sql.false)}
          title="Process Commission Payments"
        >
          <div className="flex flex-col gap-4 p-4">
            <Typography level="body-md">
              You are about to process payment for all approved commissions.
            </Typography>

            <Card className="p-4 bg-primary-50">
              <Typography level="body-sm" className="text-secondary mb-2">
                Total to Pay
              </Typography>
              <Typography level="title-lg">
                {sql`format.currency(coalesce(total_approved, 0), 'USD')`}
              </Typography>
            </Card>

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
              >
                Process Payments
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}
