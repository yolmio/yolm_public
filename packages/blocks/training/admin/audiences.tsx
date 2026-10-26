import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent } from "components/card";
import { DataTable } from "components/data_table";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { ModalDialog } from "components/modal";
import { Select } from "components/select";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  personAssignmentStatusSql,
  personStatusSql,
  personTable,
  personTypeSql,
} from "../helpers";
import { adminSelectClass } from "./shared";
import { PageShell } from "../shared";

export function TrainingAdminAudiencesPage(props: { block: TrainingBlock }) {
  const workforce = props.block.opts.workforce;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("add_audience_open", sql`false`);
        s.defScalar("add_audience_name", sql.lit``);
        s.defScalar("add_audience_description", sql.lit``);
        s.defScalar("add_audience_worker_type", sql.lit``);
        s.defScalar("add_audience_job_profile_id", sql.lit``);
        s.defScalar("add_audience_employer_organization_id", sql.lit``);
        s.defScalar("add_audience_host_organization_id", sql.lit``);
        if (workforce.orgUnitsTable) {
          s.defScalar("add_audience_org_unit_id", sql.lit``);
        }
        if (workforce.locationsTable) {
          s.defScalar("add_audience_location_id", sql.lit``);
        }
        if (workforce.positionsTable) {
          s.defScalar("add_audience_position_id", sql.lit``);
        }
        s.defScalar("add_audience_relationship_status", sql.lit``);
        s.defScalar("add_audience_assignment_status", sql.lit``);
        s.defScalar("add_audience_language", sql.lit``);
        s.defScalar("add_audience_error", {
          type: { type: "String", maxLength: 1000 },
        });
      }}
    >
      <PageShell
        title="Audiences"
        subtitle="Reusable groups of people, matched by workforce attributes, for assigning training."
        actions={
          <Button
            startIcon="GroupAdd"
            onClick={(s) => s.setScalar("add_audience_open", sql`true`)}
          >
            Add audience
          </Button>
        }
      >
        <DynamicAudiencesWorkspace block={props.block} />
      </PageShell>
    </Data>
  );
}

export function DynamicAudiencesWorkspace(props: { block: TrainingBlock }) {
  const workforce = props.block.opts.workforce;
  const hasOrgUnits = workforce.orgUnitsTable !== undefined;
  const hasLocations = workforce.locationsTable !== undefined;
  const hasPositions = workforce.positionsTable !== undefined;
  return (
    <div className="flex flex-col gap-5">
      <Data
        procedure={(s) => {
          s.defTable(
            "audience_languages",
            sql`select code, name
                from db.training_content_languages
                order by sort_order, name`,
          );
          s.defTable(
            "audience_job_profiles",
            sql`select id, name
                from db.${sql.ref(workforce.jobProfilesTable)}
                where is_active
                order by name`,
          );
          if (workforce.organizationsTable) {
            s.defTable(
              "audience_organizations",
              sql`select id, name
                from db.${sql.ref(workforce.organizationsTable)}
                where is_active
                order by name`,
            );
          }
          if (hasOrgUnits) {
            s.defTable(
              "audience_org_units",
              sql`select id, name
                  from db.${sql.ref(workforce.orgUnitsTable!)}
                  where is_active
                  order by name`,
            );
          }
          if (hasLocations) {
            s.defTable(
              "audience_locations",
              workforce.locationOptions?.() ?? sql`select id, name
                  from db.${sql.ref(workforce.locationsTable!)} order by name`,
            );
          }
          if (hasPositions) {
            s.defTable(
              "audience_positions",
              sql`select id, name
                  from db.${sql.ref(workforce.positionsTable!)}
                  where is_active
                  order by name`,
            );
          }
          // Matching criteria come from values that actually exist on
          // people — a typed value that matches nobody would silently
          // skip auto-assignment.
          s.defTable(
            "audience_worker_types",
            sql`select distinct ${
              personTypeSql(props.block.opts, sql`e`)
            } as worker_type
                from db.${sql.ref(personTable(props.block.opts))} e
                where nullif(trim(${
              personTypeSql(props.block.opts, sql`e`)
            }), '') is not null
                order by worker_type`,
          );
          s.defTable(
            "audience_relationship_statuses",
            sql`select distinct ${
              personStatusSql(props.block.opts, sql`e`)
            } as relationship_status
                from db.${sql.ref(personTable(props.block.opts))} e
                where nullif(trim(${
              personStatusSql(props.block.opts, sql`e`)
            }), '') is not null
                order by relationship_status`,
          );
          s.defTable(
            "audience_assignment_statuses",
            sql`select distinct ${
              personAssignmentStatusSql(props.block.opts, sql`e`)
            } as assignment_status
                from db.${sql.ref(personTable(props.block.opts))} e
                where nullif(trim(${
              personAssignmentStatusSql(props.block.opts, sql`e`)
            }), '') is not null
                order by assignment_status`,
          );
        }}
      >
        <Card variant="outlined">
          <CardContent>
            <DataTable
              query={sql`
                select a.id, a.name, a.description,
                       coalesce(a.worker_type, 'Any type') as worker_type,
                       coalesce(job.name, 'Any job') as job_profile_name,
                       ${
                workforce.organizationsTable
                  ? sql`coalesce(emp.name, 'Any company') as employer_name,
                       coalesce(host.name, 'Any host') as host_name,`
                  : sql``
              }
                       ${
                hasOrgUnits
                  ? sql`coalesce(unit.name, 'Any unit') as org_unit_name,`
                  : sql``
              }
                       ${
                hasLocations
                  ? sql`coalesce(location.name, 'Any location') as location_name,`
                  : sql``
              }
                       ${
                hasPositions
                  ? sql`coalesce(position.name, 'Any position') as position_name,`
                  : sql``
              }
                       coalesce(a.relationship_status, 'Any status')
                         as relationship_status,
                       coalesce(a.assignment_status, 'Any status')
                         as assignment_status,
                       coalesce(lang.name, 'Any') as language,
                       coalesce(nullif(concat_ws(' · ',
                         'Type: ' || a.worker_type,
                         'Job: ' || job.name,
                         ${
                workforce.organizationsTable
                  ? sql`'Employer: ' || emp.name,
                         'Host: ' || host.name,`
                  : sql``
              }
                         ${hasOrgUnits ? sql`'Unit: ' || unit.name,` : sql``}
                         ${
                hasLocations ? sql`'Location: ' || location.name,` : sql``
              }
                         ${
                hasPositions ? sql`'Position: ' || position.name,` : sql``
              }
                         'Relationship: ' || a.relationship_status,
                         'Assignment: ' || a.assignment_status,
                         'Language: ' || lang.name
                       ), ''), 'Everyone') as criteria,
                       case when a.is_active then 'Active' else 'Inactive' end as status
                from db.training_audiences a
                left join db.${sql.ref(workforce.jobProfilesTable)} job
                  on job.id = a.workforce_job_profile_id
                ${
                workforce.organizationsTable
                  ? sql`left join db.${
                    sql.ref(workforce.organizationsTable)
                  } emp
                  on emp.id = a.employer_workforce_organization_id
                left join db.${sql.ref(workforce.organizationsTable)} host
                  on host.id = a.host_workforce_organization_id`
                  : sql``
              }
                ${
                hasOrgUnits
                  ? sql`left join db.${sql.ref(workforce.orgUnitsTable!)} unit
                  on unit.id = a.workforce_org_unit_id`
                  : sql``
              }
                ${
                hasLocations
                  ? sql`left join (${
                    workforce.locationOptions?.({ includeInactive: true }) ??
                      sql`select id, name from db.${
                        sql.ref(workforce.locationsTable!)
                      }`
                  }) location
                  on location.id = a.workforce_location_id`
                  : sql``
              }
                ${
                hasPositions
                  ? sql`left join db.${
                    sql.ref(workforce.positionsTable!)
                  } position
                  on position.id = a.workforce_position_id`
                  : sql``
              }
                left join db.training_content_languages lang on lang.code = a.training_language
                order by case when a.is_active then 0 else 1 end, a.name
              `}
              recordName="audience"
              pageSize={8}
              searchable={[
                "name",
                "description",
                "worker_type",
                "job_profile_name",
                ...(workforce.organizationsTable
                  ? ["employer_name", "host_name"]
                  : []),
                ...(hasOrgUnits ? ["org_unit_name"] : []),
                ...(hasLocations ? ["location_name"] : []),
                ...(hasPositions ? ["position_name"] : []),
                "relationship_status",
                "assignment_status",
                "language",
                "status",
              ]}
              columns={(b) => {
                b.simpleColumn("name", "Audience", { width: "28%" });
                b.simpleColumn("criteria", "Matches people with", {
                  width: "56%",
                });
                b.simpleColumn("status", "Status", { width: "16%" });
              }}
              actions={(b) => {
                b.custom(
                  "Toggle active",
                  { icon: "PublishedWithChanges" },
                  (s) => {
                    s.tryServer({
                      body: (s) => {
                        s.startTransaction();
                        s.modify(sql`
	                          update db.training_audiences
	                          set is_active = not is_active
	                          where id = audience.id
	                        `);
                        s.commitTransaction();
                        s.refetch();
                      },
                    });
                  },
                );
              }}
            />
          </CardContent>
        </Card>

        <ModalDialog bindScalar="add_audience_open" maxWidth="lg">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Typography level="title-lg" startIcon="GroupAdd">
                Add Audience
              </Typography>
              <Typography level="body-sm" className="text-neutral-600 mt-1">
                Match people by shared workforce attributes and preferred
                language.
              </Typography>
            </div>
            <IconButton
              icon="Close"
              aria-label="Close"
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("add_audience_open", sql`false`)}
            />
          </div>
          <Show when={sql`add_audience_error is not null`}>
            <Alert color="danger" startIcon="Error" className="mb-4">
              {sql`add_audience_error`}
            </Alert>
          </Show>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormControl>
              <FormLabel>Name</FormLabel>
              <Input bindScalar="add_audience_name" />
            </FormControl>
            <FormControl>
              <FormLabel>Language</FormLabel>
              <Select
                className={adminSelectClass}
                value={sql`add_audience_language`}
                onInput={(s) =>
                  s.setScalar("add_audience_language", sql`target_value`)}
              >
                <Select.Option value="">Any language</Select.Option>
                <Each table="audience_languages" recordName="language">
                  <Select.Option value={sql`language.code`}>
                    {sql`language.name`}
                  </Select.Option>
                </Each>
              </Select>
            </FormControl>
            <FormControl className="md:col-span-2">
              <FormLabel>Description</FormLabel>
              <Textarea bindScalar="add_audience_description" minRows={2} />
            </FormControl>
            <FormControl>
              <FormLabel>Worker type</FormLabel>
              <Select
                className={adminSelectClass}
                value={sql`add_audience_worker_type`}
                onInput={(s) =>
                  s.setScalar("add_audience_worker_type", sql`target_value`)}
              >
                <Select.Option value="">Any type</Select.Option>
                <Each table="audience_worker_types" recordName="worker_type">
                  <Select.Option value={sql`worker_type.worker_type`}>
                    {sql`worker_type.worker_type`}
                  </Select.Option>
                </Each>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Job profile</FormLabel>
              <Select
                className={adminSelectClass}
                value={sql`add_audience_job_profile_id`}
                onInput={(s) =>
                  s.setScalar("add_audience_job_profile_id", sql`target_value`)}
              >
                <Select.Option value="">Any job</Select.Option>
                <Each table="audience_job_profiles" recordName="job">
                  <Select.Option value={sql`job.id`}>
                    {sql`job.name`}
                  </Select.Option>
                </Each>
              </Select>
            </FormControl>
            {workforce.organizationsTable && (
              <>
                <FormControl>
                  <FormLabel>Employer company</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`add_audience_employer_organization_id`}
                    onInput={(s) =>
                      s.setScalar(
                        "add_audience_employer_organization_id",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">Any company</Select.Option>
                    <Each table="audience_organizations" recordName="org">
                      <Select.Option value={sql`org.id`}>
                        {sql`org.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Host company</FormLabel>
                  <Select
                    className={adminSelectClass}
                    value={sql`add_audience_host_organization_id`}
                    onInput={(s) =>
                      s.setScalar(
                        "add_audience_host_organization_id",
                        sql`target_value`,
                      )}
                  >
                    <Select.Option value="">Any company</Select.Option>
                    <Each table="audience_organizations" recordName="org">
                      <Select.Option value={sql`org.id`}>
                        {sql`org.name`}
                      </Select.Option>
                    </Each>
                  </Select>
                </FormControl>
              </>
            )}
            {hasOrgUnits && (
              <FormControl>
                <FormLabel>Org unit</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`add_audience_org_unit_id`}
                  onInput={(s) =>
                    s.setScalar("add_audience_org_unit_id", sql`target_value`)}
                >
                  <Select.Option value="">Any unit</Select.Option>
                  <Each table="audience_org_units" recordName="unit">
                    <Select.Option value={sql`unit.id`}>
                      {sql`unit.name`}
                    </Select.Option>
                  </Each>
                </Select>
              </FormControl>
            )}
            {hasLocations && (
              <FormControl>
                <FormLabel>Location</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`add_audience_location_id`}
                  onInput={(s) =>
                    s.setScalar("add_audience_location_id", sql`target_value`)}
                >
                  <Select.Option value="">Any location</Select.Option>
                  <Each table="audience_locations" recordName="location">
                    <Select.Option value={sql`location.id`}>
                      {sql`location.name`}
                    </Select.Option>
                  </Each>
                </Select>
              </FormControl>
            )}
            {hasPositions && (
              <FormControl>
                <FormLabel>Position</FormLabel>
                <Select
                  className={adminSelectClass}
                  value={sql`add_audience_position_id`}
                  onInput={(s) =>
                    s.setScalar("add_audience_position_id", sql`target_value`)}
                >
                  <Select.Option value="">Any position</Select.Option>
                  <Each table="audience_positions" recordName="position">
                    <Select.Option value={sql`position.id`}>
                      {sql`position.name`}
                    </Select.Option>
                  </Each>
                </Select>
              </FormControl>
            )}
            <FormControl>
              <FormLabel>Relationship status</FormLabel>
              <Select
                className={adminSelectClass}
                value={sql`add_audience_relationship_status`}
                onInput={(s) =>
                  s.setScalar(
                    "add_audience_relationship_status",
                    sql`target_value`,
                  )}
              >
                <Select.Option value="">Any status</Select.Option>
                <Each
                  table="audience_relationship_statuses"
                  recordName="relationship_status"
                >
                  <Select.Option
                    value={sql`relationship_status.relationship_status`}
                  >
                    {sql`relationship_status.relationship_status`}
                  </Select.Option>
                </Each>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel>Assignment status</FormLabel>
              <Select
                className={adminSelectClass}
                value={sql`add_audience_assignment_status`}
                onInput={(s) =>
                  s.setScalar(
                    "add_audience_assignment_status",
                    sql`target_value`,
                  )}
              >
                <Select.Option value="">Any status</Select.Option>
                <Each
                  table="audience_assignment_statuses"
                  recordName="assignment_status"
                >
                  <Select.Option
                    value={sql`assignment_status.assignment_status`}
                  >
                    {sql`assignment_status.assignment_status`}
                  </Select.Option>
                </Each>
              </Select>
            </FormControl>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Button
              variant="plain"
              color="neutral"
              onClick={(s) => s.setScalar("add_audience_open", sql`false`)}
            >
              Cancel
            </Button>
            <Button
              startIcon="Save"
              onClick={(s) => {
                s.setScalar("add_audience_error", sql`null`);
                s.tryServer({
                  body: (s) => {
                    s.if(sql`trim(ui.add_audience_name) = ''`, (s) => {
                      s.setScalar(
                        "ui.add_audience_error",
                        sql.lit`Audience name is required.`,
                      );
                      s.return();
                    });
                    s.startTransaction();
                    let audienceColumns = sql`name, description, worker_type,
                         workforce_job_profile_id,
                         ${
                      workforce.organizationsTable
                        ? sql`employer_workforce_organization_id,
                         host_workforce_organization_id,`
                        : sql``
                    }
                         relationship_status, assignment_status,
                         training_language`;
                    let audienceValues = sql`trim(ui.add_audience_name),
                         nullif(trim(ui.add_audience_description), ''),
                         nullif(trim(ui.add_audience_worker_type), ''),
                         nullif(trim(ui.add_audience_job_profile_id), '')::bigint,
                         ${
                      workforce.organizationsTable
                        ? sql`nullif(trim(ui.add_audience_employer_organization_id), '')::bigint,
                         nullif(trim(ui.add_audience_host_organization_id), '')::bigint,`
                        : sql``
                    }
                         nullif(trim(ui.add_audience_relationship_status), ''),
                         nullif(trim(ui.add_audience_assignment_status), ''),
                         nullif(ui.add_audience_language, '')`;
                    if (hasOrgUnits) {
                      audienceColumns =
                        sql`${audienceColumns}, workforce_org_unit_id`;
                      audienceValues =
                        sql`${audienceValues}, nullif(trim(ui.add_audience_org_unit_id), '')::bigint`;
                    }
                    if (hasLocations) {
                      audienceColumns =
                        sql`${audienceColumns}, workforce_location_id`;
                      audienceValues =
                        sql`${audienceValues}, nullif(trim(ui.add_audience_location_id), '')::bigint`;
                    }
                    if (hasPositions) {
                      audienceColumns =
                        sql`${audienceColumns}, workforce_position_id`;
                      audienceValues =
                        sql`${audienceValues}, nullif(trim(ui.add_audience_position_id), '')::bigint`;
                    }
                    s.modify(sql`
	                      insert into db.training_audiences
	                        (${audienceColumns})
                      values
                        (${audienceValues})
	                    `);
                    s.commitTransaction();
                    s.setScalar("ui.add_audience_name", sql.lit``);
                    s.setScalar("ui.add_audience_description", sql.lit``);
                    s.setScalar("ui.add_audience_worker_type", sql.lit``);
                    s.setScalar("ui.add_audience_job_profile_id", sql.lit``);
                    s.setScalar(
                      "ui.add_audience_employer_organization_id",
                      sql.lit``,
                    );
                    s.setScalar(
                      "ui.add_audience_host_organization_id",
                      sql.lit``,
                    );
                    if (hasOrgUnits) {
                      s.setScalar("ui.add_audience_org_unit_id", sql.lit``);
                    }
                    if (hasLocations) {
                      s.setScalar("ui.add_audience_location_id", sql.lit``);
                    }
                    if (hasPositions) {
                      s.setScalar("ui.add_audience_position_id", sql.lit``);
                    }
                    s.setScalar(
                      "ui.add_audience_relationship_status",
                      sql.lit``,
                    );
                    s.setScalar("ui.add_audience_assignment_status", sql.lit``);
                    s.setScalar("ui.add_audience_language", sql.lit``);
                    s.setScalar("ui.add_audience_open", sql`false`);
                    s.refetch();
                  },
                  catch: (s) => {
                    s.setScalar(
                      "add_audience_error",
                      sql.lit`Audience could not be created.`,
                    );
                  },
                });
              }}
            >
              Create audience
            </Button>
          </div>
        </ModalDialog>
      </Data>
    </div>
  );
}
