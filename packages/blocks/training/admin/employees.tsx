import { Button } from "components/button";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { Select } from "components/select";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  employeeName,
  formatDateSql,
  personTable,
  trainingComplianceLabels,
  trainingFeatureEnabled,
  workforceProvider,
} from "../helpers";
import { EmptyState, PageShell, StatTile } from "../shared";
import { adminEmployeeHref, adminSelectClass } from "./shared";

export function TrainingAdminPeoplePage(
  props: { block: TrainingBlock },
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("employee_search", sql.lit``);
        s.defScalar("employee_activity_filter", sql.lit`active`);
        s.defScalar("employee_status_filter", sql.lit`all`);
      }}
    >
      <EmployeeFilesAndCompliance block={props.block} />
    </Data>
  );
}

export function EmployeeFilesAndCompliance(props: { block: TrainingBlock }) {
  const includeCompliance = trainingFeatureEnabled(
    props.block.opts,
    "compliance",
  );
  const complianceLabels = trainingComplianceLabels;
  const employeeBaseSql = sql`select e.id,
                ${employeeName(props.block.opts, sql`e`)} as name,
                person_status.open_task_count as open_tasks,
                person_status.pending_validation_count as pending_validation,
                ${
    includeCompliance
      ? sql`coalesce((select count(*) from db.training_retraining_cases r where r.person_id = e.id and r.status = 'open'), 0)`
      : sql`0`
  } as open_retraining,
                ${
    includeCompliance ? sql`person_status.cert_alert_count` : sql`0`
  } as cert_alerts,
                ${
    includeCompliance
      ? sql`coalesce((select count(*) from db.training_personnel_documents p where p.person_id = e.id), 0)`
      : sql`0`
  } as personnel_notes,
                person_status.last_completion_at as last_completion_at
              from db.${sql.ref(personTable(props.block.opts))} e
              join db.training_person_training_status person_status
                on person_status.person_id = e.id
              where ui.employee_activity_filter = 'all'
                 or coalesce(${
    workforceProvider(props.block.opts).personAccessEligible(sql`e`)
  }, false) = (ui.employee_activity_filter = 'active')`;
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "employee_file_summary",
          sql`with employee_base as (${employeeBaseSql})
              select
                count(*) as employee_count,
                coalesce(sum(open_tasks), 0) as open_tasks,
                coalesce(sum(pending_validation), 0) as pending_validation,
                coalesce(sum(open_retraining), 0) as open_retraining,
                coalesce(sum(cert_alerts), 0) as cert_alerts
              from employee_base`,
        );
      }}
    >
      <Data
        debounce={{ wait: 300 }}
        watch={[
          sql`employee_search`,
          sql`employee_activity_filter`,
          sql`employee_status_filter`,
        ]}
        procedure={(s) => {
          s.defTable(
            "employee_files",
            sql`with employee_base as (${employeeBaseSql})
              select *
              from employee_base
              where (
                  trim(ui.employee_search) = ''
                  or lower(name) like '%' || lower(trim(ui.employee_search)) || '%'
                )
                and (
                  ui.employee_status_filter = 'all'
                  or (ui.employee_status_filter = 'attention' and (open_tasks > 0 or pending_validation > 0 or open_retraining > 0 or cert_alerts > 0))
                  or (ui.employee_status_filter = 'training' and open_tasks > 0)
                  or (ui.employee_status_filter = 'validation' and pending_validation > 0)
                  or (ui.employee_status_filter = 'retraining' and open_retraining > 0)
                  or (ui.employee_status_filter = 'certs' and cert_alerts > 0)
                )
              order by
                case when open_tasks > 0 or pending_validation > 0 or open_retraining > 0 or cert_alerts > 0 then 0 else 1 end,
                name`,
          );
        }}
      >
        <PageShell
          title={includeCompliance
            ? "People & training"
            : "People training files"}
          subtitle={includeCompliance
            ? `Each person's training record, retraining cases, ${complianceLabels.certificationsTitle.toLowerCase()}, and ${complianceLabels.personnelTitle.toLowerCase()}.`
            : "Each person's training record: completed courses, signed policies, check sheets, and essays."}
        >
          <div>
            <div
              className={`grid grid-cols-2 ${
                includeCompliance ? "lg:grid-cols-4" : "lg:grid-cols-3"
              } gap-3 mb-4`}
            >
              <StatTile
                label="People"
                value={sql`employee_file_summary.employee_count`}
                icon="Groups"
                tone="bg-neutral-100 text-neutral-700"
              />
              <StatTile
                label="Open training"
                value={sql`employee_file_summary.open_tasks`}
                icon="Assignment"
                tone="bg-amber-50 text-amber-800"
              />
              <StatTile
                label="Pending validation"
                value={sql`employee_file_summary.pending_validation`}
                icon="Rule"
                tone="bg-sky-50 text-sky-700"
              />
              {includeCompliance && (
                <StatTile
                  label="Cert alerts"
                  value={sql`employee_file_summary.cert_alerts`}
                  icon="WorkspacePremium"
                  tone="bg-danger-50 text-danger-700"
                />
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
              <FormControl className="md:col-span-2">
                <FormLabel>Search people</FormLabel>
                <Input
                  bindScalar="employee_search"
                  placeholder="Search employee name"
                />
              </FormControl>
              <FormControl>
                <FormLabel>Personnel</FormLabel>
                <Select
                  aria-label="Personnel"
                  className={adminSelectClass}
                  value={sql`employee_activity_filter`}
                  onInput={(s) =>
                    s.setScalar("employee_activity_filter", sql`target_value`)}
                >
                  <Select.Option value="active">Active personnel</Select.Option>
                  <Select.Option value="inactive">
                    Inactive personnel
                  </Select.Option>
                  <Select.Option value="all">All personnel</Select.Option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Training status</FormLabel>
                <Select
                  aria-label="Training status"
                  className={adminSelectClass}
                  value={sql`employee_status_filter`}
                  onInput={(s) =>
                    s.setScalar("employee_status_filter", sql`target_value`)}
                >
                  <Select.Option value="all">
                    All training statuses
                  </Select.Option>
                  <Select.Option value="attention">
                    Needs attention
                  </Select.Option>
                  <Select.Option value="training">Open training</Select.Option>
                  <Select.Option value="validation">
                    Pending validation
                  </Select.Option>
                  {includeCompliance && (
                    <>
                      <Select.Option value="retraining">
                        Retraining
                      </Select.Option>
                      <Select.Option value="certs">
                        Cert alerts
                      </Select.Option>
                    </>
                  )}
                </Select>
              </FormControl>
            </div>
            <Show when={sql`employee_activity_filter = 'inactive'`}>
              <Typography level="body-sm" className="text-neutral-600 mb-4">
                Training records and files are retained for inactive personnel.
                Reactivate their workforce record when they return.
              </Typography>
            </Show>
            <div className="overflow-hidden border border-divider rounded-md bg-white">
              <div
                className={`hidden lg:grid ${
                  includeCompliance ? "grid-cols-7" : "grid-cols-4"
                } gap-3 px-4 py-2 bg-neutral-50 border-b border-divider`}
              >
                <Typography
                  level="body-sm"
                  className="text-neutral-600 col-span-2"
                >
                  Employee
                </Typography>
                <Typography level="body-sm" className="text-neutral-600">
                  Training
                </Typography>
                {includeCompliance && (
                  <>
                    <Typography level="body-sm" className="text-neutral-600">
                      Retraining
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      {complianceLabels.certificationsTitle}
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      Personnel file
                    </Typography>
                  </>
                )}
                <Typography
                  level="body-sm"
                  className="text-neutral-600 text-right"
                >
                  Actions
                </Typography>
              </div>
              <Show when={sql`not exists (select 1 from employee_files)`}>
                <div className="p-4">
                  <EmptyState
                    icon="ManageSearch"
                    title="No matching people"
                    body="Adjust the search, personnel, or training status filter."
                  />
                </div>
              </Show>
              <Each table="employee_files" recordName="employee">
                <div
                  className={`grid grid-cols-1 ${
                    includeCompliance ? "lg:grid-cols-7" : "lg:grid-cols-4"
                  } gap-3 px-4 py-3 border-b border-divider last:border-b-0 bg-white`}
                >
                  <div className="lg:col-span-2">
                    <Typography level="title-sm">
                      {sql`employee.name`}
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      Last completed:{" "}
                      {sql`coalesce(${
                        formatDateSql(sql`employee.last_completion_at`)
                      }, 'None yet')`}
                    </Typography>
                  </div>
                  <div>
                    <Typography
                      level="body-sm"
                      className="lg:hidden text-neutral-600"
                    >
                      Training
                    </Typography>
                    <div className="flex flex-wrap gap-2">
                      <CountChip
                        value={sql`employee.open_tasks`}
                        singular="open"
                        plural="open"
                        color="warning"
                      />
                      <Show when={sql`employee.pending_validation > 0`}>
                        <Chip size="sm" variant="soft" color="primary">
                          {sql`employee.pending_validation::string ||
                            ' to validate'`}
                        </Chip>
                      </Show>
                    </div>
                  </div>
                  {includeCompliance && (
                    <>
                      <div>
                        <Typography
                          level="body-sm"
                          className="lg:hidden text-neutral-600"
                        >
                          Retraining
                        </Typography>
                        <CountChip
                          value={sql`employee.open_retraining`}
                          singular="open"
                          plural="open"
                          color="warning"
                        />
                      </div>
                      <div>
                        <Typography
                          level="body-sm"
                          className="lg:hidden text-neutral-600"
                        >
                          Certifications
                        </Typography>
                        <CountChip
                          value={sql`employee.cert_alerts`}
                          singular="alert"
                          plural="alerts"
                          color="danger"
                        />
                      </div>
                      <div>
                        <Typography
                          level="body-sm"
                          className="lg:hidden text-neutral-600"
                        >
                          Personnel file
                        </Typography>
                        <CountChip
                          value={sql`employee.personnel_notes`}
                          singular="note"
                          plural="notes"
                          color="neutral"
                        />
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-end">
                    <Button
                      component="a"
                      href={adminEmployeeHref(props.block, sql`employee.id`)}
                      size="sm"
                      variant="outlined"
                      color="neutral"
                      endIcon="ChevronRight"
                    >
                      View file
                    </Button>
                  </div>
                </div>
              </Each>
            </div>
          </div>
        </PageShell>
      </Data>
    </Data>
  );
}

/** A count chip that recedes to a dash at zero so real work stands out. */
function CountChip(props: {
  value: Sql;
  singular: string;
  plural: string;
  color: "warning" | "primary" | "danger" | "neutral";
}) {
  return (
    <>
      <Show when={sql`${props.value} > 0`}>
        <Chip size="sm" variant="soft" color={props.color}>
          {sql`${props.value}::string || case when ${props.value} = 1
            then ${sql.lit(" " + props.singular)}
            else ${sql.lit(" " + props.plural)} end`}
        </Chip>
      </Show>
      <Show when={sql`coalesce(${props.value}, 0) = 0`}>
        <Typography level="body-sm" className="text-neutral-500">
          —
        </Typography>
      </Show>
    </>
  );
}
