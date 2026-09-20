import { Button } from "components/button";
import { Card } from "components/card";
import { EnumSelect } from "components/enum_select";
import { IconButton } from "components/icon_button";
import { MaterialIcon } from "components/material_icon";
import { PageHeader } from "components/page_header";
import { StatRow } from "components/stat_row";
import { Table } from "components/table";
import { Typography } from "components/typography";
import { sql } from "std/sql_utils";
import { Data } from "std/data";
import { Each, Route, Show } from "std/ui";

/**
 * Standard admin page that lists rows from the `auth_login_failures`
 * table (failed logins, OTP attempts, password resets, etc.) with
 * auth-type filter and pagination.
 *
 * Self-routing — mounts itself at `/auth-failures`. Drop it into your
 * admin app's routing tree without wrapping in `<Route>`. Pairs with
 * `AuthBlock`, which writes the underlying records.
 *
 * @category Page Component
 */
export function AuthLoginFailuresPage() {
  return (
    <Route path="/auth-failures">
      <Data
        local
        procedure={(s) => {
          s.defScalar("selected_auth_type", {
            type: { type: "Enum", enum: "session_token_type" },
          });
          s.defScalar("page_size", 50);
          s.defScalar("page", 0);
        }}
      >
        <Data
          watch={[sql`selected_auth_type`, sql`page`]}
          procedure={(s) => {
            // Get total count with filters
            s.defScalar(
              "total_failures",
              sql`(select count(*) from auth_login_failures
                  where (
                    selected_auth_type is null
                    or auth_type = selected_auth_type
                  )
                  )`,
            );

            // Main query with pagination and filters
            s.defTable(
              "login_failures",
              sql`select
                    f.*
                  from auth_login_failures f
                  where (
                    selected_auth_type is null
                    or f.auth_type = selected_auth_type
                  )

                  order by f.attempted_at desc
                  limit ${sql`page_size`}
                  offset ${sql`page * page_size`}`,
            );

            s.defScalar(
              "failures_24h",
              sql`(select count(*)
                   from auth_login_failures
                   where attempted_at > date.add(hour, -24, now()))`,
            );

            // Most common failure reason in last 24h
            s.defRecord(
              "top_failure_24h",
              sql`select failure_reason, count(*) as count
                  from auth_login_failures
                  where attempted_at > date.add(hour, -24, now())
                  group by failure_reason
                  order by count desc
                  limit 1`,
            );

            // Unique identifiers with failures in last 24h
            s.defScalar(
              "unique_identifiers_24h",
              sql`(select count(distinct identifier)
                   from auth_login_failures
                   where attempted_at > date.add(hour, -24, now()))`,
            );
          }}
        >
          <div className="container mx-auto p-4">
            <PageHeader>
              <div>
                <Typography level="h2">Authentication Failures</Typography>
                <Typography level="body-lg" sx={{ maxWidth: 600 }}>
                  Monitor failed login attempts to detect potential security
                  issues and improve user experience.
                </Typography>
              </div>
            </PageHeader>

            {/* Stats */}
            <StatRow
              stats={[
                {
                  title: "Failures (24h)",
                  value: sql`coalesce(failures_24h, 0)`,
                  color: "danger",
                },
                {
                  title: "Top Failure Reason (24h)",
                  value: sql`case when top_failure_24h.count is not null
                              then top_failure_24h.failure_reason || ' (' || top_failure_24h.count || ')'
                              else 'None' end`,
                  color: "warning",
                },
                {
                  title: "Unique Identifiers (24h)",
                  value: sql`coalesce(unique_identifiers_24h, 0)`,
                  color: "primary",
                },
              ]}
            />

            {/* Filters */}
            <Card className="mb-6">
              <div className="flex flex-wrap gap-4">
                <EnumSelect
                  enum="session_token_type"
                  value={sql`selected_auth_type`}
                  onChange={(s) => {
                    s.setScalar("selected_auth_type", sql`target_value`);
                    s.setScalar("page", 0);
                  }}
                  nullVariant="All Auth Types"
                  className="w-48"
                />

                <Show when={sql`selected_auth_type is not null`}>
                  <Button
                    variant="plain"
                    size="sm"
                    onClick={(s) => {
                      s.setScalar("selected_auth_type", sql.null);
                      s.setScalar("page", 0);
                    }}
                  >
                    Clear Filters
                  </Button>
                </Show>
              </div>
            </Card>

            {/* Failures Table */}
            <Card>
              <Table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Identifier</th>
                    <th>User</th>
                    <th>Failure Reason</th>
                    <th>Auth Type</th>
                  </tr>
                </thead>
                <tbody>
                  <Each table="login_failures" recordName="failure">
                    <tr>
                      <td>
                        <Typography level="body-sm">
                          {sql`failure.attempted_at::string`}
                        </Typography>
                      </td>
                      <td>
                        <Typography
                          level="body-sm"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {sql`failure.identifier`}
                        </Typography>
                      </td>
                      <td>
                        <Show
                          when={sql`failure.sys_user_id is not null`}
                          fallback={
                            <Typography level="body-sm" color="neutral">
                              No user found
                            </Typography>
                          }
                        >
                          <Typography level="body-sm">
                            User ID: {sql`failure.sys_user_id`}
                          </Typography>
                        </Show>
                      </td>
                      <td>
                        <Typography level="body-sm">
                          {sql`failure.failure_reason`}
                        </Typography>
                      </td>
                      <td>
                        <Typography level="body-sm">
                          {sql`failure.auth_type::string`}
                        </Typography>
                      </td>
                    </tr>
                  </Each>
                </tbody>
              </Table>

              <Show when={sql`total_failures = 0`}>
                <div className="flex flex-col items-center justify-center py-12">
                  <MaterialIcon
                    icon="CheckCircle"
                    sx={{ fontSize: 48, color: "success.main", mb: 2 }}
                  />
                  <Typography level="body-lg">
                    No login failures found
                  </Typography>
                  <Typography level="body-sm" color="neutral">
                    {sql`case
                      when selected_auth_type is not null
                      then 'Try adjusting your filters'
                      else 'All login attempts have been successful'
                    end`}
                  </Typography>
                </div>
              </Show>

              <Show when={sql`total_failures > page_size`}>
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <Typography level="body-sm">
                    Showing {sql`page * page_size + 1`} -{" "}
                    {sql`least((page + 1) * page_size, total_failures)`} of{" "}
                    {sql`total_failures`}
                  </Typography>
                  <div className="flex gap-2">
                    <IconButton
                      disabled={sql`page = 0`}
                      onClick={(s) => s.setScalar("page", sql`page - 1`)}
                    >
                      <MaterialIcon icon="ChevronLeft" />
                    </IconButton>
                    <IconButton
                      disabled={sql`(page + 1) * page_size >= total_failures`}
                      onClick={(s) => s.setScalar("page", sql`page + 1`)}
                    >
                      <MaterialIcon icon="ChevronRight" />
                    </IconButton>
                  </div>
                </div>
              </Show>
            </Card>
          </div>
        </Data>
      </Data>
    </Route>
  );
}
