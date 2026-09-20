import { Card, CardHeader } from "components/card";
import { Chip } from "components/chip";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { SearchCardPage } from "pages/search_card_page";
import { sql } from "../../std/sql_utils";
import { Data } from "std/data";
import { Show } from "std/ui";
import type { Node } from "std/ui";

interface TimeOffPageProps {
  path?: string;
}

export function TimeOffPage(props: TimeOffPageProps): Node {
  return (
    <SearchCardPage
      table="availability_time_off_periods"
      path={props.path ?? "/time-off"}
      recordName="time_off_record"
      search={false}
      display="list"
      orderBy={sql`start_date asc, id asc`}
      header={
        <div className="flex justify-between items-center mb-8">
          <Typography level="h1">Agent Time Off</Typography>
        </div>
      }
      card={<TimeOffCard />}
      where={sql`(start_date >= current_date() or end_date >= current_date())
        and sys_user_id in (select id from sys_users where agent_id is not null)`}
    />
  );
}

function TimeOffCard(): Node {
  return (
    <Card variant="outlined" className="self-start w-full">
      <CardHeader
        className="p-4 border-b border-divider"
        sx={{
          bgcolor: "background.level1",
        }}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-[40px] h-[40px] rounded-[50%] bg-warning-100 flex items-center justify-center">
              <MaterialIcon
                icon="EventBusy"
                className="text-xl text-warning-600"
              />
            </div>
            <div>
              <Typography level="title-md" className="mb-1">
                {sql`time_off_record.title`}
              </Typography>
              <Typography
                level="body-sm"
                component="div"
                sx={{ color: "text.secondary" }}
              >
                <Data
                  procedure={(s) => {
                    s.defRecord(
                      "agent_info",
                      sql`select a.name, a.email from db.sys_users su join db.agents a on a.id = su.agent_id where su.id = time_off_record.sys_user_id`,
                    );
                  }}
                  pendingFallback={null}
                  errorFallback={null}
                >
                  {sql`agent_info.name`} ({sql`agent_info.email`})
                </Data>
              </Typography>
            </div>
          </div>
          <Data
            local
            procedure={(s) => {
              s.defScalar(
                "days_until",
                sql`date.diff(day, now(), time_off_record.start_date)`,
              );
            }}
          >
            <Show
              when={sql`time_off_record.start_date <= now()`}
              fallback={
                <Show when={sql`days_until <= 7`}>
                  <Chip
                    size="sm"
                    variant="soft"
                    color="warning"
                    startDecorator={<MaterialIcon icon="Schedule" />}
                  >
                    <Show when={sql`days_until = 0`}>Starting Today</Show>
                    <Show when={sql`days_until = 1`}>Tomorrow</Show>
                    <Show when={sql`days_until > 1`}>
                      In {sql`days_until`} days
                    </Show>
                  </Chip>
                </Show>
              }
            >
              <Chip
                size="sm"
                variant="soft"
                color="primary"
                startDecorator={<MaterialIcon icon="EventBusy" />}
              >
                In progress
              </Chip>
            </Show>
          </Data>
        </div>
      </CardHeader>
      <div className="p-4">
        <div className="flex gap-6 mb-3">
          <div className="flex items-center gap-2">
            <MaterialIcon
              icon="CalendarMonth"
              className="text-base text-neutral-500"
            />
            <Typography level="body-sm">
              <strong>Start:</strong> {sql`time_off_record.start_date`}
            </Typography>
          </div>
          <div className="flex items-center gap-2">
            <MaterialIcon
              icon="CalendarMonth"
              className="text-base text-neutral-500"
            />
            <Typography level="body-sm">
              <strong>End:</strong> {sql`time_off_record.end_date`}
            </Typography>
          </div>
          <Data
            local
            procedure={(s) => {
              s.defScalar(
                "duration_days",
                sql`date.diff(day, time_off_record.start_date, time_off_record.end_date) + 1`,
              );
            }}
          >
            <div className="flex items-center gap-2">
              <MaterialIcon
                icon="DateRange"
                className="text-base text-neutral-500"
              />
              <span className="text-sm">
                <strong>Duration:</strong>{" "}
                <Show when={sql`duration_days = 1`}>1 day</Show>
                <Show when={sql`duration_days > 1`}>
                  {sql`duration_days`} days
                </Show>
              </span>
            </div>
          </Data>
        </div>
        <div className="mt-3 p-3 bg-neutral-50 rounded-md">
          <Typography level="body-sm" sx={{ color: "text.secondary" }}>
            <strong>Notes:</strong> {sql`time_off_record.notes`}
          </Typography>
        </div>
      </div>
    </Card>
  );
}
