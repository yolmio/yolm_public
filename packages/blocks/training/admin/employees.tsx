import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { Input } from "components/input";
import { Select } from "components/select";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  employeeName,
  formatDateSql,
  personTable,
  trainingComplianceLabels,
  trainingFeatureEnabled,
} from "../helpers";
import { EmptyState, StatTile } from "../shared";
import {
  adminEmployeeHref,
  adminSelectClass,
  TrainingAdminFrame,
} from "./shared";

export function TrainingAdminPeoplePage(
  props: { block: TrainingBlock },
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("employee_search", sql.lit``);
        s.defScalar("employee_status_filter", sql.lit`all`);
      }}
    >
      <TrainingAdminFrame>
        <EmployeeFilesAndCompliance block={props.block} />
      </TrainingAdminFrame>
    </Data>
  );
}

export function EmployeeFilesAndCompliance(props: { block: TrainingBlock }) {
  const includeCompliance = trainingFeatureEnabled(
    props.block.opts,
    "compliance",
  );
  const complianceLabels = trainingComplianceLabels;
  return (
    <Data
      watch={[sql`employee_search`, sql`employee_status_filter`]}
      procedure={(s) => {
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
                on person_status.person_id = e.id`;
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
      <div className="flex flex-col gap-5">
        <Card variant="outlined">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 w-full">
              <div>
                <Typography level="title-lg" startIcon="FolderShared">
                  {includeCompliance
                    ? "People Files & Compliance"
                    : "People Training Files"}
                </Typography>
                <Typography level="body-sm" className="text-neutral-600 mt-1">
                  {includeCompliance
                    ? `Completion history, retraining cases, ${complianceLabels.certificationsTitle.toLowerCase()}, expirations, and ${complianceLabels.personnelTitle.toLowerCase()} by employee.`
                    : "Completion history, signed policies, check sheets, and essays by employee."}
                </Typography>
              </div>
            </div>
          </CardHeader>
          <CardContent>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <FormControl className="md:col-span-2">
                <FormLabel>Search people</FormLabel>
                <Input
                  bindScalar="employee_search"
                  placeholder="Search employee name"
                />
              </FormControl>
              <FormControl>
                <FormLabel>Status</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`employee_status_filter`}
                  onInput={(s) =>
                    s.setScalar("employee_status_filter", sql`target_value`)}
                >
                  <Select.Option value="all">All people</Select.Option>
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
                    icon="PersonSearch"
                    title="No matching people"
                    body="Adjust the employee search or status filter."
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
                      Last validated:{" "}
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
                      <Chip size="sm" variant="soft" color="warning">
                        {sql`employee.open_tasks`} open
                      </Chip>
                      <Chip size="sm" variant="soft" color="primary">
                        {sql`employee.pending_validation`} pending validation
                      </Chip>
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
                        <Chip size="sm" variant="soft" color="warning">
                          {sql`employee.open_retraining`} open
                        </Chip>
                      </div>
                      <div>
                        <Typography
                          level="body-sm"
                          className="lg:hidden text-neutral-600"
                        >
                          Certifications
                        </Typography>
                        <Chip size="sm" variant="soft" color="danger">
                          {sql`employee.cert_alerts`} alerts
                        </Chip>
                      </div>
                      <div>
                        <Typography
                          level="body-sm"
                          className="lg:hidden text-neutral-600"
                        >
                          Personnel file
                        </Typography>
                        <Chip size="sm" variant="soft" color="neutral">
                          {sql`employee.personnel_notes`} notes
                        </Chip>
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
          </CardContent>
        </Card>
      </div>
    </Data>
  );
}
