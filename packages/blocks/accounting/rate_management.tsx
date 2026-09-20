import { type Sql, sql } from "std/sql_utils";
import { Button } from "components/button";
import { Card } from "components/card";
import { Chip } from "components/chip";
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
import { Checkbox } from "components/checkbox";
import { Textarea } from "components/textarea";
import { Step, StepIndicator, Stepper } from "components/stepper";
import { Divider } from "components/divider";
import type { DomStatements } from "std/statements";
import { EachSelect } from "components/each_select";

export function RateCalculatorWizard() {
  const calculateRate = (s: DomStatements) => {
    s.defScalar("base", sql`rate_lookup.base_rate`);
    s.server((s) => {
      s.defScalar(
        "discount",
        sql`coalesce((
      select vd.discount_percent
      from db.volume_discounts vd
      where (vd.client_id = ui.selected_client_id or vd.client_id is null)
        and ui.order_volume >= vd.min_volume
        and (vd.max_volume is null or ui.order_volume <= vd.max_volume)
      order by vd.discount_percent desc
      limit 1
    ), 0)`,
      );

      // Apply TAT premium
      s.defScalar(
        "premium",
        sql`coalesce((
      select tt.premium_percent
      from db.tat_pricing tt
      where tt.tat_type = ui.selected_tat
        and tt.is_active
    ), 0)`,
      );

      s.defScalar(
        "surcharge",
        sql`
    case when ui.include_surcharges then
      case
        when exists (
          select 1 from db.clients c
          where c.id = ui.selected_client_id and c.type = 'npe'
        ) and ui.selected_search_type in (
          'civil'::enums.search_type,
          'family'::enums.search_type
        )
        then 15.00
        when exists (
          select 1 from db.clients c
          where c.id = ui.selected_client_id and c.type = 'mx'
        )
        then 20.00
        else 0
      end
    else 0
    end`,
      );
    });

    s.setScalar("calculated_base_rate", sql`base`);
    s.setScalar("volume_discount", sql`base * discount / 100`);
    s.setScalar("tat_premium", sql`base * premium / 100`);
    s.setScalar("surcharge_amount", sql`surcharge`);
    s.setScalar(
      "final_rate",
      sql`
      base - (base * discount / 100) + (base * premium / 100) + surcharge
    `,
    );

    // Calculate margin
    s.setScalar(
      "margin_percent",
      sql`
      case when final_rate > 0 then
        round((final_rate - rate_lookup.researcher_cost) / final_rate * 100, 2)
      else 0
      end
    `,
    );
  };

  const nextStep = (s: DomStatements) => {
    s.if(sql`active_step < 3`, (s) => {
      s.setScalar("active_step", sql`active_step + 1`);
      // Recalculate when moving to results step
      s.if(sql`active_step = 2`, (s) => {
        calculateRate(s);
      });
    });
  };

  const prevStep = (s: DomStatements) => {
    s.if(sql`active_step > 0`, (s) => {
      s.setScalar("active_step", sql`active_step - 1`);
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("active_step", sql`0`);
        s.defScalar("selected_client_id", sql.null);
        s.defScalar("selected_jurisdiction_id", sql.null);
        s.defScalar("selected_search_type", {
          type: { type: "Enum", enum: "search_type" },
        });
        s.defScalar("selected_tat", {
          type: { type: "Enum", enum: "tat_type" },
          expr: sql`'standard'::enums.tat_type`,
        });
        s.defScalar("order_volume", sql`1`);
        s.defScalar("include_surcharges", sql.true);

        // Rate calculation results
        s.defScalar("calculated_base_rate", sql`0`);
        s.defScalar("volume_discount", sql`0`);
        s.defScalar("tat_premium", sql`0`);
        s.defScalar("surcharge_amount", sql`0`);
        s.defScalar("final_rate", sql`0`);
        s.defScalar("margin_percent", sql`0`);

        // Multi-dimensional rate lookup
        s.defRecord(
          "rate_lookup",
          sql`
      select
        -- Client-specific rate (most specific)
        cr_specific.amount as client_specific_rate,
        -- Client default rate for search type
        cr_type.amount as client_type_rate,
        -- Client base rate
        cr_base.amount as client_base_rate,
        -- Default rate for jurisdiction/search type
        dr_specific.amount as default_specific_rate,
        -- Default rate for jurisdiction
        dr_jurisdiction.amount as default_jurisdiction_rate,
        -- Default base rate
        dr_base.amount as default_base_rate,
        -- Use the most specific rate available
        coalesce(
          cr_specific.amount,
          cr_type.amount,
          cr_base.amount,
          dr_specific.amount,
          dr_jurisdiction.amount,
          dr_base.amount,
          0
        ) as base_rate,
        -- Get researcher cost for margin calculation
        coalesce(
          rr_specific.rate,
          rr_jurisdiction.rate,
          rr_base.rate,
          0
        ) as researcher_cost
      from (select 1 as dummy) d
      -- Client-specific rates
      left join db.client_rates cr_specific on
        cr_specific.client_id = ui.selected_client_id
        and cr_specific.jurisdiction_id = ui.selected_jurisdiction_id
        and cr_specific.search_type = ui.selected_search_type
        and cr_specific.is_active
      left join db.client_rates cr_type on
        cr_type.client_id = ui.selected_client_id
        and cr_type.jurisdiction_id is null
        and cr_type.search_type = ui.selected_search_type
        and cr_type.is_active
      left join db.client_rates cr_base on
        cr_base.client_id = ui.selected_client_id
        and cr_base.jurisdiction_id is null
        and cr_base.search_type is null
        and cr_base.is_active
      -- Default rates
      left join db.client_rates dr_specific on
        dr_specific.client_id is null
        and dr_specific.jurisdiction_id = ui.selected_jurisdiction_id
        and dr_specific.search_type = ui.selected_search_type
        and dr_specific.is_active
      left join db.client_rates dr_jurisdiction on
        dr_jurisdiction.client_id is null
        and dr_jurisdiction.jurisdiction_id = ui.selected_jurisdiction_id
        and dr_jurisdiction.search_type is null
        and dr_jurisdiction.is_active
      left join db.client_rates dr_base on
        dr_base.client_id is null
        and dr_base.jurisdiction_id is null
        and dr_base.search_type is null
        and dr_base.is_active
      -- Researcher rates for margin calculation
      left join db.researcher_rates rr_specific on
        rr_specific.jurisdiction_id = ui.selected_jurisdiction_id
        and rr_specific.search_type = ui.selected_search_type
        and rr_specific.is_active
      left join db.researcher_rates rr_jurisdiction on
        rr_jurisdiction.jurisdiction_id = ui.selected_jurisdiction_id
        and rr_jurisdiction.search_type is null
        and rr_jurisdiction.is_active
      left join db.researcher_rates rr_base on
        rr_base.jurisdiction_id is null
        and rr_base.search_type is null
        and rr_base.is_active
      where ui.selected_client_id is not null
        and ui.selected_jurisdiction_id is not null
        and ui.selected_search_type is not null
      limit 1
      `,
        );

        // Volume discount tiers
        s.defTable(
          "volume_tiers",
          sql`
      select
        vd.id,
        vd.min_volume,
        vd.max_volume,
        vd.discount_percent,
        case
          when ui.order_volume >= vd.min_volume
            and (vd.max_volume is null or ui.order_volume <= vd.max_volume)
          then true
          else false
        end as is_applicable
      from db.volume_discounts vd
      where vd.client_id = ui.selected_client_id
        or (vd.client_id is null and not exists (
          select 1 from db.volume_discounts vd2
          where vd2.client_id = ui.selected_client_id
        ))
      order by vd.min_volume
      `,
        );

        // Clients for selection
        s.defTable(
          "ui_clients",
          sql`select id, name, code from db.clients order by name`,
        );
        // Jurisdictions for selection
        s.defTable(
          "ui_jurisdictions",
          sql`select id, name from db.jurisdictions order by name`,
        );
      }}
    >
      <div className="flex flex-col gap-6 p-6">
        <Typography level="title-lg">Rate Calculator Wizard</Typography>

        <Stepper size="lg">
          <Step
            activeLineColor="primary"
            dotted
            indicator={
              <StepIndicator
                color="primary"
                variant="soft"
                activeVariant="solid"
              >
                <MaterialIcon icon="Group" />
              </StepIndicator>
            }
            active={sql`active_step >= 0`}
          >
            Select Client & Location
          </Step>
          <Step
            activeLineColor="primary"
            dotted
            indicator={
              <StepIndicator
                color="primary"
                variant="soft"
                activeVariant="solid"
              >
                <MaterialIcon icon="Settings" />
              </StepIndicator>
            }
            active={sql`active_step >= 1`}
          >
            Configure Options
          </Step>
          <Step
            activeLineColor="primary"
            dotted
            indicator={
              <StepIndicator
                color="primary"
                variant="soft"
                activeVariant="solid"
              >
                <MaterialIcon icon="Calculate" />
              </StepIndicator>
            }
            active={sql`active_step >= 2`}
          >
            Calculate Rate
          </Step>
        </Stepper>

        {/* Step 1: Client & Location */}
        <Show when={sql`active_step = 0`}>
          <Card className="p-6">
            <Typography level="title-md" className="mb-4">
              Select Client & Location
            </Typography>

            <div className="flex flex-col gap-4">
              <FormControl fullWidth>
                <FormLabel>Client</FormLabel>
                <EachSelect
                  table="ui_clients"
                  value={sql`selected_client_id`}
                  onChange={(s, recordId) => {
                    s.setScalar("selected_client_id", sql`${recordId}`);
                  }}
                  variant="outlined"
                  fullWidth
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a client"
                />
              </FormControl>

              <FormControl fullWidth>
                <FormLabel>Jurisdiction</FormLabel>
                <EachSelect
                  table="ui_jurisdictions"
                  value={sql`selected_jurisdiction_id`}
                  onChange={(s, recordId) => {
                    s.setScalar("selected_jurisdiction_id", sql`${recordId}`);
                  }}
                  variant="outlined"
                  fullWidth
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a jurisdiction"
                />
              </FormControl>

              <FormControl fullWidth>
                <FormLabel>Search Type</FormLabel>
                <EnumSelect
                  enum="search_type"
                  value={sql`selected_search_type`}
                  onChange={(s) =>
                    s.setScalar("selected_search_type", sql`target_value`)}
                  variant="outlined"
                  fullWidth
                  nullVariant="Select search type"
                />
              </FormControl>
            </div>

            <div className="flex justify-end mt-6">
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => nextStep(s)}
                disabled={sql`
                selected_client_id is null
                or selected_jurisdiction_id is null
                or selected_search_type is null
              `}
              >
                Next
              </Button>
            </div>
          </Card>
        </Show>

        {/* Step 2: Configure Options */}
        <Show when={sql`active_step = 1`}>
          <Card className="p-6">
            <Typography level="title-md" className="mb-4">
              Configure Options
            </Typography>

            <div className="flex flex-col gap-4">
              <FormControl fullWidth>
                <FormLabel>Order Volume</FormLabel>
                <Input
                  type="number"
                  value={sql`order_volume`}
                  onInput={(s) =>
                    s.setScalar("order_volume", sql`target_value`)}
                  variant="outlined"
                  fullWidth
                  min="1"
                  placeholder="Enter expected order volume"
                />
                <Typography level="body-sm" className="text-secondary mt-1">
                  Enter the expected number of orders for volume discount
                  calculation
                </Typography>
              </FormControl>

              <FormControl fullWidth>
                <FormLabel>Turnaround Time</FormLabel>
                <EnumSelect
                  enum="tat_type"
                  value={sql`selected_tat`}
                  onChange={(s) =>
                    s.setScalar("selected_tat", sql`target_value`)}
                  variant="outlined"
                  fullWidth
                />
              </FormControl>

              <FormControl>
                <Checkbox
                  checked={sql`include_surcharges`}
                  onChange={(s) =>
                    s.setScalar(
                      "include_surcharges",
                      sql`not include_surcharges`,
                    )}
                >
                  Include applicable surcharges
                </Checkbox>
              </FormControl>

              {/* Show applicable volume discount tiers */}
              <Show when={sql`(select count(*) from volume_tiers) > 0`}>
                <div className="mt-4">
                  <Typography level="body-md" className="mb-2">
                    Volume Discount Tiers
                  </Typography>
                  <div className="space-y-2">
                    <Each table="volume_tiers" recordName="tier">
                      <div
                        dynamicClasses={[
                          {
                            classes:
                              "p-2 rounded border border-primary-300 bg-primary-50",
                            condition: sql`tier.is_applicable`,
                          },
                          {
                            classes: "p-2 rounded border border-divider",
                            condition: sql`not tier.is_applicable`,
                          },
                        ]}
                      >
                        <Typography level="body-sm">
                          {sql`tier.min_volume`} -{" "}
                          {sql`coalesce(cast(tier.max_volume as string), '∞')`}
                          {" "}
                          orders:
                          <span className="font-semibold ml-1">
                            {sql`tier.discount_percent`}% discount
                          </span>
                        </Typography>
                      </div>
                    </Each>
                  </div>
                </div>
              </Show>
            </div>

            <div className="flex justify-between mt-6">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => prevStep(s)}
              >
                Back
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => nextStep(s)}
              >
                Calculate
              </Button>
            </div>
          </Card>
        </Show>

        {/* Step 3: Results */}
        <Show when={sql`active_step = 2`}>
          <Card className="p-6">
            <Typography level="title-md" className="mb-4">
              Rate Calculation Results
            </Typography>

            <div className="space-y-4">
              <div className="bg-surface p-4 rounded">
                <Typography level="body-sm" className="text-secondary mb-2">
                  Base Rate
                </Typography>
                <Typography level="title-lg">
                  {sql`format.currency(calculated_base_rate, 'USD')`}
                </Typography>
              </div>

              <Divider />

              <div className="space-y-2">
                <Show when={sql`volume_discount > 0`}>
                  <div className="flex justify-between">
                    <Typography level="body-md">Volume Discount</Typography>
                    <Typography level="body-md" className="text-success-600">
                      -{sql`format.currency(volume_discount, 'USD')`}
                    </Typography>
                  </div>
                </Show>

                <Show when={sql`tat_premium > 0`}>
                  <div className="flex justify-between">
                    <Typography level="body-md">TAT Premium</Typography>
                    <Typography level="body-md" className="text-warning-600">
                      +{sql`format.currency(tat_premium, 'USD')`}
                    </Typography>
                  </div>
                </Show>

                <Show when={sql`surcharge_amount > 0`}>
                  <div className="flex justify-between">
                    <Typography level="body-md">Surcharge</Typography>
                    <Typography level="body-md" className="text-warning-600">
                      +{sql`format.currency(surcharge_amount, 'USD')`}
                    </Typography>
                  </div>
                </Show>
              </div>

              <Divider />

              <div className="bg-primary-soft p-4 rounded">
                <Typography level="body-sm" className="text-primary-soft mb-2">
                  Final Rate
                </Typography>
                <Typography level="title-lg" className="text-primary-700">
                  {sql`format.currency(final_rate, 'USD')`}
                </Typography>
              </div>

              <div className="bg-surface p-4 rounded">
                <div className="flex justify-between items-center">
                  <Typography level="body-md">Estimated Margin</Typography>
                  <Show when={sql`margin_percent >= 30`}>
                    <Chip size="md" variant="soft" color="success">
                      {sql`margin_percent`}%
                    </Chip>
                  </Show>
                  <Show
                    when={sql`margin_percent >= 20 and margin_percent < 30`}
                  >
                    <Chip size="md" variant="soft" color="warning">
                      {sql`margin_percent`}%
                    </Chip>
                  </Show>
                  <Show when={sql`margin_percent < 20`}>
                    <Chip size="md" variant="soft" color="danger">
                      {sql`margin_percent`}%
                    </Chip>
                  </Show>
                </div>
                <Typography level="body-sm" className="text-secondary mt-1">
                  Based on researcher cost of{" "}
                  {sql`format.currency(rate_lookup.researcher_cost, 'USD')`}
                </Typography>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => prevStep(s)}
              >
                Back
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => {
                  // Reset wizard
                  s.setScalar("active_step", sql`0`);
                  s.setScalar("selected_client_id", sql.null);
                  s.setScalar("selected_jurisdiction_id", sql.null);
                  s.setScalar("selected_search_type", sql.null);
                  s.setScalar("order_volume", sql`1`);
                }}
              >
                New Calculation
              </Button>
            </div>
          </Card>
        </Show>
      </div>
    </Data>
  );
}

export function ClientRateProposals() {
  const createProposal = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.modify(sql`
          insert into db.client_rate_proposals (
            client_id,
            proposal_name,
            description,
            valid_until,
            status,
            created_by
          ) values (
            ui.new_proposal_client_id,
            ui.proposal_name,
            ui.proposal_description,
            ui.valid_until,
            'pending',
            current_user
          )
        `);

        s.commitTransaction();
        s.setScalar("proposal_modal_open", sql.false);
        s.setScalar("new_proposal_client_id", sql.null);
        s.setScalar("proposal_name", sql.lit``);
        s.setScalar("proposal_description", sql.lit``);
      },
    });
  };

  const approveProposal = (proposalId: Sql) => (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        // Update proposal status
        s.modify(sql`
          update db.client_rate_proposals
          set
            status = 'approved',
            approved_by = current_user,
            approved_date = current_timestamp()
          where id = ${proposalId}
        `);

        // Create new client rates from proposal
        s.modify(sql`
          insert into db.client_rates (
            client_id,
            jurisdiction_id,
            search_type,
            rate_type,
            amount,
            effective_from,
            is_active
          )
          select
            crp.client_id,
            crpd.jurisdiction_id,
            crpd.search_type,
            crpd.rate_type,
            crpd.proposed_rate,
            current_date(),
            true
          from db.client_rate_proposal_details crpd
          join db.client_rate_proposals crp on crpd.proposal_id = crp.id
          where crpd.proposal_id = ${proposalId}
        `);

        s.commitTransaction();
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("filter_status", sql.lit`pending`);
        s.defScalar("proposal_modal_open", sql.false);
        s.defScalar("selected_proposal_id", sql.null);
        s.defScalar("new_proposal_client_id", sql.null);

        // Proposal form fields
        s.defScalar("proposal_name", sql.lit``);
        s.defScalar("proposal_description", sql.lit``);
        s.defScalar("valid_until", sql`date.add(day, 30, current_date())`);

        // Proposals list
        s.defTable(
          "proposals",
          sql`
          select
            crp.id,
            crp.proposal_name,
            c.name as client_name,
            crp.status,
            crp.valid_until,
            crp.created_at,
            crp.approved_by,
            count(distinct crpd.id) as rate_count,
            avg(crpd.margin_percent) as avg_margin
          from db.client_rate_proposals crp
          join db.clients c on crp.client_id = c.id
          left join db.client_rate_proposal_details crpd on crp.id = crpd.proposal_id
          where case ui.filter_status
            when 'pending' then crp.status = 'pending'
            when 'approved' then crp.status = 'approved'
            when 'rejected' then crp.status = 'rejected'
            else true
          end
          group by crp.id, crp.proposal_name, c.name, crp.status, crp.valid_until, crp.created_at, crp.approved_by
          order by crp.created_at desc
          `,
        );

        // Proposal details
        s.defTable(
          "proposal_details",
          sql`
          select
            crpd.id,
            crpd.jurisdiction_id,
            j.name as jurisdiction_name,
            crpd.search_type,
            crpd.rate_type,
            crpd.current_rate,
            crpd.proposed_rate,
            crpd.volume_commitment,
            crpd.estimated_cost,
            crpd.margin_percent
          from db.client_rate_proposal_details crpd
          left join db.jurisdictions j on crpd.jurisdiction_id = j.id
          where crpd.proposal_id = ui.selected_proposal_id
          order by j.name, crpd.search_type
          `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Client Rate Proposals</Typography>
          <Button
            variant="solid"
            color="primary"
            onClick={(s) => s.setScalar("proposal_modal_open", sql.true)}
          >
            <MaterialIcon icon="Add" className="mr-1" />
            New Proposal
          </Button>
        </div>

        <div className="flex gap-4">
          <Select
            value={sql`filter_status`}
            onChange={(s) => s.setScalar("filter_status", sql`target_value`)}
            variant="outlined"
            size="sm"
          >
            <Select.Option value="all">All Proposals</Select.Option>
            <Select.Option value="pending">Pending</Select.Option>
            <Select.Option value="approved">Approved</Select.Option>
            <Select.Option value="rejected">Rejected</Select.Option>
          </Select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Proposals List */}
          <Card className="lg:col-span-2 p-4">
            <Table>
              <thead>
                <tr>
                  <th>Proposal</th>
                  <th>Client</th>
                  <th>Valid Until</th>
                  <th>Rates</th>
                  <th>Avg Margin</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <Each table="proposals" recordName="proposal">
                  <tr
                    className="cursor-pointer hover:bg-surface"
                    onClick={(s) =>
                      s.setScalar("selected_proposal_id", sql`proposal.id`)}
                  >
                    <td>{sql`proposal.proposal_name`}</td>
                    <td>{sql`proposal.client_name`}</td>
                    <td>
                      {sql`format.date(proposal.valid_until, '%Y-%m-%d')`}
                    </td>
                    <td>{sql`proposal.rate_count`}</td>
                    <td>
                      <Show when={sql`proposal.avg_margin is not null`}>
                        <Show when={sql`proposal.avg_margin >= 30`}>
                          <Chip size="sm" variant="soft" color="success">
                            {sql`round(proposal.avg_margin, 1)`}%
                          </Chip>
                        </Show>
                        <Show
                          when={sql`proposal.avg_margin >= 20 and proposal.avg_margin < 30`}
                        >
                          <Chip size="sm" variant="soft" color="warning">
                            {sql`round(proposal.avg_margin, 1)`}%
                          </Chip>
                        </Show>
                        <Show when={sql`proposal.avg_margin < 20`}>
                          <Chip size="sm" variant="soft" color="danger">
                            {sql`round(proposal.avg_margin, 1)`}%
                          </Chip>
                        </Show>
                      </Show>
                    </td>
                    <td>
                      <Show when={sql`proposal.status = 'pending'`}>
                        <Chip size="sm" variant="soft" color="warning">
                          {sql`proposal.status`}
                        </Chip>
                      </Show>
                      <Show when={sql`proposal.status = 'approved'`}>
                        <Chip size="sm" variant="soft" color="success">
                          {sql`proposal.status`}
                        </Chip>
                      </Show>
                      <Show when={sql`proposal.status = 'rejected'`}>
                        <Chip size="sm" variant="soft" color="danger">
                          {sql`proposal.status`}
                        </Chip>
                      </Show>
                      <Show when={sql`proposal.status = 'expired'`}>
                        <Chip size="sm" variant="soft" color="neutral">
                          {sql`proposal.status`}
                        </Chip>
                      </Show>
                    </td>
                    <td>
                      <Show when={sql`proposal.status = 'pending'`}>
                        <Button
                          variant="outlined"
                          size="sm"
                          onClick={approveProposal(sql`proposal.id`)}
                        >
                          Approve
                        </Button>
                      </Show>
                    </td>
                  </tr>
                </Each>
              </tbody>
            </Table>
          </Card>

          {/* Proposal Details */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Proposal Details
            </Typography>
            <Show when={sql`selected_proposal_id is not null`}>
              <div className="overflow-y-auto max-h-[600px]">
                <Each table="proposal_details" recordName="detail">
                  <div className="mb-4 p-3 border border-divider rounded">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <Typography level="body-md" className="font-semibold">
                          {sql`detail.jurisdiction_name`}
                        </Typography>
                        <Typography level="body-sm" className="text-secondary">
                          {sql`detail.search_type`} • {sql`detail.rate_type`}
                        </Typography>
                      </div>
                      <Show when={sql`detail.margin_percent >= 30`}>
                        <Chip size="sm" variant="soft" color="success">
                          {sql`detail.margin_percent`}%
                        </Chip>
                      </Show>
                      <Show
                        when={sql`detail.margin_percent >= 20 and detail.margin_percent < 30`}
                      >
                        <Chip size="sm" variant="soft" color="warning">
                          {sql`detail.margin_percent`}%
                        </Chip>
                      </Show>
                      <Show when={sql`detail.margin_percent < 20`}>
                        <Chip size="sm" variant="soft" color="danger">
                          {sql`detail.margin_percent`}%
                        </Chip>
                      </Show>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <Typography level="body-sm">Current Rate:</Typography>
                        <Typography level="body-sm">
                          {sql`format.currency(detail.current_rate, 'USD')`}
                        </Typography>
                      </div>
                      <div className="flex justify-between">
                        <Typography level="body-sm" className="font-semibold">
                          Proposed Rate:
                        </Typography>
                        <Typography level="body-sm" className="font-semibold">
                          {sql`format.currency(detail.proposed_rate, 'USD')`}
                        </Typography>
                      </div>
                      <Show when={sql`detail.volume_commitment > 0`}>
                        <div className="flex justify-between">
                          <Typography level="body-sm">
                            Volume Commitment:
                          </Typography>
                          <Typography level="body-sm">
                            {sql`detail.volume_commitment`} orders
                          </Typography>
                        </div>
                      </Show>
                    </div>
                  </div>
                </Each>
              </div>
            </Show>
            <Show when={sql`selected_proposal_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Description"
                  className="text-4xl text-tertiary mb-2"
                />
                <Typography level="body-sm" className="text-tertiary">
                  Select a proposal to view details
                </Typography>
              </div>
            </Show>
          </Card>
        </div>

        {/* New Proposal Modal */}
        <ModalDialog
          open={sql`proposal_modal_open`}
          onClose={(s) => s.setScalar("proposal_modal_open", sql.false)}
          title="Create Rate Proposal"
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Client</FormLabel>
              <Data
                procedure={(s) => {
                  s.defTable(
                    "clients",
                    sql`select id, name from db.clients order by name`,
                  );
                }}
              >
                <EachSelect
                  table="clients"
                  value={sql`new_proposal_client_id`}
                  onChange={(s, recordId) => {
                    s.setScalar("new_proposal_client_id", sql`${recordId}`);
                  }}
                  variant="outlined"
                  fullWidth
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a client"
                />
              </Data>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Proposal Name</FormLabel>
              <Input
                value={sql`proposal_name`}
                onInput={(s) => s.setScalar("proposal_name", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="e.g., Q1 2025 Rate Adjustment"
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Description</FormLabel>
              <Textarea
                value={sql`proposal_description`}
                onChange={(s) =>
                  s.setScalar("proposal_description", sql`target_value`)}
                rows={3}
                variant="outlined"
                fullWidth
                placeholder="Brief description of the proposal"
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Valid Until</FormLabel>
              <Input
                type="date"
                value={sql`valid_until`}
                onInput={(s) => s.setScalar("valid_until", sql`target_value`)}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("proposal_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => createProposal(s)}
                disabled={sql`new_proposal_client_id is null or proposal_name = ''`}
              >
                Create Proposal
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}

export function ResearcherRatesManager() {
  const saveRate = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.if(sql`edit_rate_id is not null`, (s) => {
          // Update existing rate
          s.modify(sql`
            update db.researcher_rates
            set
              rate = ui.form_rate,
              jurisdiction_id = ui.form_jurisdiction_id,
              search_type = ui.form_search_type
            where id = ui.edit_rate_id
          `);
        });

        s.if(sql`edit_rate_id is null`, (s) => {
          // Deactivate existing rate if exists
          s.modify(sql`
            update db.researcher_rates
            set is_active = false
            where researcher_id = ui.form_researcher_id
              and coalesce(jurisdiction_id, 0) = coalesce(ui.form_jurisdiction_id, 0)
              and (search_type = ui.form_search_type or (search_type is null and ui.form_search_type is null))
              and is_active
          `);

          // Insert new rate
          s.modify(sql`
            insert into db.researcher_rates (
              researcher_id,
              jurisdiction_id,
              search_type,
              rate,
              is_active
            ) values (
              ui.form_researcher_id,
              ui.form_jurisdiction_id,
              ui.form_search_type,
              ui.form_rate,
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
        s.defScalar("selected_researcher_id", sql.null);
        s.defScalar("filter_jurisdiction_id", sql.null);
        s.defScalar("filter_search_type", {
          type: { type: "Enum", enum: "search_type" },
        });
        s.defScalar("rate_modal_open", sql.false);
        s.defScalar("edit_rate_id", sql.null);

        // Form fields
        s.defScalar("form_researcher_id", sql.null);
        s.defScalar("form_jurisdiction_id", sql.null);
        s.defScalar("form_search_type", {
          type: { type: "Enum", enum: "search_type" },
        });
        s.defScalar("form_rate", sql`0`);

        // Researchers list
        s.defTable(
          "researchers",
          sql`
          select
            r.id,
            r.name,
            r.code,
            count(distinct rr.id) as rate_count,
            avg(rr.rate) as avg_rate,
            count(distinct o.id) as order_count
          from db.researchers r
          left join db.researcher_rates rr on r.id = rr.researcher_id and rr.is_active
          left join db.orders o on r.id = o.researcher_id
            and o.created_at >= current_date() - interval '90 days'
          where r.is_active
          group by r.id, r.name, r.code
          order by r.name
          `,
        );

        // Rates for selected researcher
        s.defTable(
          "researcher_rates",
          sql`
          select
            rr.id,
            rr.researcher_id,
            rr.jurisdiction_id,
            j.name as jurisdiction_name,
            rr.search_type,
            rr.rate,
            rr.created_at,
            rr.is_active,
            count(distinct o.id) as recent_orders
          from db.researcher_rates rr
          left join db.jurisdictions j on rr.jurisdiction_id = j.id
          left join db.orders o on
            o.researcher_id = rr.researcher_id
            and o.jurisdiction_id = rr.jurisdiction_id
            and o.search_type = rr.search_type
            and o.created_at >= current_date() - interval '30 days'
          where rr.researcher_id = ui.selected_researcher_id
            and rr.is_active
            and (ui.filter_jurisdiction_id is null or rr.jurisdiction_id = ui.filter_jurisdiction_id)
            and (ui.filter_search_type is null or rr.search_type = ui.filter_search_type)
          group by rr.id, rr.researcher_id, rr.jurisdiction_id, j.name, rr.search_type, rr.rate, rr.created_at, rr.is_active
          order by j.name, rr.search_type
          `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <Typography level="title-lg">Researcher Rates Manager</Typography>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Researchers List */}
          <Card className="p-4">
            <Typography level="title-md" className="mb-4">
              Researchers
            </Typography>
            <div className="overflow-y-auto max-h-[600px]">
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
                    s.setScalar("selected_researcher_id", sql`researcher.id`)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <Typography level="body-md" className="font-semibold">
                        {sql`researcher.name`}
                      </Typography>
                      <Typography level="body-sm" className="text-secondary">
                        Code: {sql`researcher.code`}
                      </Typography>
                    </div>
                    <div className="text-right">
                      <Typography level="body-xs" className="text-secondary">
                        {sql`researcher.rate_count`} rates
                      </Typography>
                      <Typography level="body-xs" className="text-secondary">
                        {sql`researcher.order_count`} recent orders
                      </Typography>
                    </div>
                  </div>
                </div>
              </Each>
            </div>
          </Card>

          <Card className="lg:col-span-2 p-4">
            <Show when={sql`selected_researcher_id is not null`}>
              <div className="flex justify-between items-center mb-4">
                <Typography level="title-md">Rates Configuration</Typography>
                <Button
                  variant="solid"
                  color="primary"
                  size="sm"
                  onClick={(s) => {
                    s.setScalar("rate_modal_open", sql.true);
                    s.setScalar("edit_rate_id", sql.null);
                    s.setScalar(
                      "form_researcher_id",
                      sql`selected_researcher_id`,
                    );
                    s.setScalar("form_jurisdiction_id", sql.null);
                    s.setScalar("form_search_type", sql.null);
                    s.setScalar("form_rate", sql`0`);
                  }}
                >
                  <MaterialIcon icon="Add" className="mr-1" />
                  Add Rate
                </Button>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-2 gap-2 mb-4">
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
                    value={sql`filter_jurisdiction_id`}
                    onChange={(s, recordId) => {
                      s.setScalar("filter_jurisdiction_id", sql`${recordId}`);
                    }}
                    variant="outlined"
                    size="sm"
                    fullWidth
                    optionLabel="name"
                    optionValue="id"
                    placeholder="All Jurisdictions"
                  />
                </Data>

                <EnumSelect
                  enum="search_type"
                  value={sql`filter_search_type`}
                  onChange={(s) =>
                    s.setScalar("filter_search_type", sql`target_value`)}
                  variant="outlined"
                  size="sm"
                  fullWidth
                  nullVariant="All Search Types"
                />
              </div>

              {/* Rates Table */}
              <Table>
                <thead>
                  <tr>
                    <th>Jurisdiction</th>
                    <th>Search Type</th>
                    <th>Rate</th>
                    <th>Recent Orders</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <Each table="researcher_rates" recordName="rate">
                    <tr>
                      <td>
                        {sql`coalesce(rate.jurisdiction_name, 'All Jurisdictions')`}
                      </td>
                      <td>
                        {sql`coalesce(rate.search_type::string, 'All Types')`}
                      </td>
                      <td>{sql`format.currency(rate.rate, 'USD')`}</td>
                      <td>
                        <Show when={sql`rate.recent_orders > 0`}>
                          <Chip size="sm" variant="soft" color="primary">
                            {sql`rate.recent_orders`} orders
                          </Chip>
                        </Show>
                      </td>
                      <td>
                        <IconButton
                          variant="plain"
                          size="sm"
                          onClick={(s) => {
                            s.setScalar("rate_modal_open", sql.true);
                            s.setScalar("edit_rate_id", sql`rate.id`);
                            s.setScalar(
                              "form_researcher_id",
                              sql`rate.researcher_id`,
                            );
                            s.setScalar(
                              "form_jurisdiction_id",
                              sql`rate.jurisdiction_id`,
                            );
                            s.setScalar(
                              "form_search_type",
                              sql`rate.search_type`,
                            );
                            s.setScalar("form_rate", sql`rate.rate`);
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

            <Show when={sql`selected_researcher_id is null`}>
              <div className="text-center py-8">
                <MaterialIcon
                  icon="Person"
                  className="text-6xl text-tertiary mb-4"
                />
                <Typography level="body-lg" className="text-tertiary">
                  Select a researcher to manage rates
                </Typography>
              </div>
            </Show>
          </Card>
        </div>

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
              <FormLabel>Rate Amount</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_rate`}
                onInput={(s) => s.setScalar("form_rate", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="0.00"
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
                disabled={sql`form_rate <= 0`}
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

export function SlidingScaleRates() {
  const createScale = (s: DomStatements) => {
    s.tryServer({
      body: (s) => {
        s.startTransaction();

        s.modify(sql`
          insert into db.sliding_scale_rates (
            client_id,
            scale_name,
            description,
            scale_type,
            base_rate,
            is_active
          ) values (
            ui.selected_client_id,
            ui.form_name,
            ui.form_description,
            ui.form_scale_type,
            ui.form_base_rate,
            true
          )
        `);

        s.defScalar(
          "new_scale_id",
          sql`last_record_id(db.sliding_scale_rates)`,
        );

        s.if(sql`form_scale_type = 'volume'`, (s) => {
          s.modify(sql`
            insert into db.sliding_scale_tiers (scale_id, min_value, max_value, discount_percent, description)
            values
              (new_scale_id, 1, 10, 0, 'Base rate'),
              (new_scale_id, 11, 50, 5, '5% discount'),
              (new_scale_id, 51, 100, 10, '10% discount'),
              (new_scale_id, 101, null, 15, '15% discount')
          `);
        });

        s.commitTransaction();
        s.setScalar("scale_modal_open", sql.false);
      },
    });
  };

  return (
    <Data
      procedure={(s) => {
        s.defScalar("selected_client_id", sql.null);
        s.defScalar("scale_modal_open", sql.false);
        s.defScalar("edit_scale_id", {
          expr: sql`null::bigint`,
          allowNoRead: true,
        });

        s.defScalar("form_name", sql.lit``);
        s.defScalar("form_description", sql.lit``);
        s.defScalar("form_scale_type", sql.lit`volume`);
        s.defScalar("form_base_rate", sql`0`);

        s.defTable(
          "sliding_scales",
          sql`
          select
            ss.id,
            ss.client_id,
            c.name as client_name,
            ss.scale_name,
            ss.scale_type,
            ss.base_rate,
            count(distinct sst.id) as tier_count,
            ss.is_active
          from db.sliding_scale_rates ss
          left join db.clients c on ss.client_id = c.id
          left join db.sliding_scale_tiers sst on ss.id = sst.scale_id
          where (ui.selected_client_id is null or ss.client_id = ui.selected_client_id)
            and ss.is_active
          group by ss.id, ss.client_id, c.name, ss.scale_name, ss.scale_type, ss.base_rate, ss.is_active
          order by c.name, ss.scale_name
          `,
        );
      }}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex justify-between items-center">
          <Typography level="title-lg">Sliding Scale Rates</Typography>
          <Button
            variant="solid"
            color="primary"
            onClick={(s) => s.setScalar("scale_modal_open", sql.true)}
          >
            <MaterialIcon icon="Add" className="mr-1" />
            New Scale
          </Button>
        </div>

        <Card className="p-4">
          <div className="mb-4">
            <Data
              procedure={(s) => {
                s.defTable(
                  "clients",
                  sql`select id, name from db.clients order by name`,
                );
              }}
            >
              <EachSelect
                table="clients"
                value={sql`selected_client_id`}
                onChange={(s, recordId) => {
                  s.setScalar("selected_client_id", sql`${recordId}`);
                }}
                variant="outlined"
                size="sm"
                optionLabel="name"
                optionValue="id"
                placeholder="All Clients"
              />
            </Data>
          </div>

          <Table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Scale Name</th>
                <th>Type</th>
                <th>Base Rate</th>
                <th>Tiers</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <Each table="sliding_scales" recordName="scale">
                <tr>
                  <td>{sql`scale.client_name`}</td>
                  <td>{sql`scale.scale_name`}</td>
                  <td>
                    <Chip size="sm" variant="soft" color="neutral">
                      {sql`scale.scale_type`}
                    </Chip>
                  </td>
                  <td>{sql`format.currency(scale.base_rate, 'USD')`}</td>
                  <td>{sql`scale.tier_count`} tiers</td>
                  <td>
                    <Show when={sql`scale.is_active`}>
                      <Chip size="sm" variant="soft" color="success">
                        Active
                      </Chip>
                    </Show>
                  </td>
                  <td>
                    <IconButton
                      variant="plain"
                      size="sm"
                      onClick={(s) => {
                        s.setScalar("edit_scale_id", sql`scale.id`);
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

        {/* New Scale Modal */}
        <ModalDialog
          open={sql`scale_modal_open`}
          onClose={(s) => s.setScalar("scale_modal_open", sql.false)}
          title="Create Sliding Scale"
        >
          <div className="flex flex-col gap-4 p-4">
            <FormControl fullWidth>
              <FormLabel>Client</FormLabel>
              <Data
                procedure={(s) => {
                  s.defTable(
                    "clients",
                    sql`select id, name from db.clients order by name`,
                  );
                }}
              >
                <EachSelect
                  table="clients"
                  value={sql`selected_client_id`}
                  onChange={(s, recordId) => {
                    s.setScalar("selected_client_id", sql`${recordId}`);
                  }}
                  variant="outlined"
                  fullWidth
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a client"
                />
              </Data>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Scale Name</FormLabel>
              <Input
                value={sql`form_name`}
                onInput={(s) => s.setScalar("form_name", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="e.g., Volume Discount Scale"
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Description</FormLabel>
              <Textarea
                value={sql`form_description`}
                onChange={(s) =>
                  s.setScalar("form_description", sql`target_value`)}
                rows={2}
                variant="outlined"
                fullWidth
              />
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Scale Type</FormLabel>
              <Select
                value={sql`form_scale_type`}
                onChange={(s) =>
                  s.setScalar("form_scale_type", sql`target_value`)}
                variant="outlined"
                fullWidth
              >
                <Select.Option value="volume">Volume-based</Select.Option>
                <Select.Option value="revenue">Revenue-based</Select.Option>
                <Select.Option value="time">Time-based</Select.Option>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <FormLabel>Base Rate</FormLabel>
              <Input
                type="number"
                step="0.01"
                value={sql`form_base_rate`}
                onInput={(s) =>
                  s.setScalar("form_base_rate", sql`target_value`)}
                variant="outlined"
                fullWidth
                placeholder="0.00"
              />
            </FormControl>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outlined"
                color="neutral"
                onClick={(s) => s.setScalar("scale_modal_open", sql.false)}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                color="primary"
                onClick={(s) => createScale(s)}
                disabled={sql`selected_client_id is null or form_name = '' or form_base_rate <= 0`}
              >
                Create Scale
              </Button>
            </div>
          </div>
        </ModalDialog>
      </div>
    </Data>
  );
}
