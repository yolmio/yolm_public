import { queryParamsString } from "std/services";
import { sql } from "../std/sql_utils";
import type { Sql } from "../std/sql_utils";
import type { Style } from "std/style_types";
import { Data } from "std/data";
import { Menu } from "./menu";
import type { Color, Size, Variant } from "./types";

interface AddToCalendarProps {
  size?: Size;
  variant?: Variant;
  color?: Color;
  sx?: Style;
  title: Sql;
  description?: Sql;
  startTime: Sql;
  endTime: Sql;
  location?: Sql;
  organizerName?: Sql;
  organizerEmail?: Sql;
  downloading?: boolean;
}

/**
 * Build an iCalendar (.ics) document body for a single event. Returned
 * as a SQL expression so callers can serve it from an endpoint or attach
 * it to an email.
 */
export function formatAsICal(props: {
  title: Sql;
  description?: Sql;
  startTime: Sql;
  endTime: Sql;
  location?: Sql;
  uniqueId: Sql;
  organizerName?: Sql;
  organizerEmail?: Sql;
  inviteeName?: Sql;
  inviteeEmail?: Sql;
  downloading?: boolean;
}) {
  const formatDateIcal = (date: Sql) =>
    sql`format.date(${date}, '%Y%m%dT%H%M%S')`;
  const escapeIcalText = (text: Sql) =>
    sql`replace(replace(replace(replace(${text}, '\\', '\\\\'), ';', '\\;'), ',', '\\,'), '\n', '\\n')`;
  const foldLine = (content: Sql) =>
    sql`(
      with recursive folded_lines(line, remaining, line_number) as (
        select
          substring(${content}, 1, 74),
          substring(${content}, 75),
          1
        union all
        select
          substring(remaining, 1, 74),
          substring(remaining, 75),
          line_number + 1
        from folded_lines
        where length(remaining) > 0
      )
      select string_agg(
        case when line_number = 1 then line else concat('\r\n ', line) end,
        ''
        order by line_number
      )
      from folded_lines
    )`;

  const escapedTitle = escapeIcalText(props.title);
  const escapedDescription = props.description
    ? escapeIcalText(props.description)
    : undefined;
  const escapedLocation = props.location
    ? escapeIcalText(props.location)
    : undefined;
  const escapedOrganizerName = props.organizerName
    ? escapeIcalText(props.organizerName)
    : undefined;
  const escapedInviteeName = props.inviteeName
    ? escapeIcalText(props.inviteeName)
    : undefined;

  const nowUtc = sql`now() at time zone 'UTC'`;

  return sql.concat(
    "BEGIN:VCALENDAR\r\n",
    "VERSION:2.0\r\n",
    "PRODID:-//Yolm//NONSGML Calendar//EN\r\n",
    props.downloading ? "METHOD:PUBLISH\r\n" : "METHOD:REQUEST\r\n",
    "BEGIN:VEVENT\r\n",
    "UID:",
    props.uniqueId,
    "\r\n",
    "DTSTAMP:",
    formatDateIcal(nowUtc),
    "Z\r\n",
    "CREATED:",
    formatDateIcal(nowUtc),
    "Z\r\n",
    foldLine(sql.concat("SUMMARY:", escapedTitle)),
    "\r\n",
    foldLine(
      sql.concat(
        "DTSTART:",
        formatDateIcal(sql`${props.startTime} at time zone 'UTC'`),
        "Z",
      ),
    ),
    "\r\n",
    foldLine(
      sql.concat(
        "DTEND:",
        formatDateIcal(sql`${props.endTime} at time zone 'UTC'`),
        "Z",
      ),
    ),
    "\r\n",
    "STATUS:CONFIRMED\r\n",
    props.description
      ? sql.concat(
        foldLine(sql.concat("DESCRIPTION:", escapedDescription)),
        "\r\n",
      )
      : "",
    props.location
      ? sql.concat(foldLine(sql.concat("LOCATION:", escapedLocation)), "\r\n")
      : "",
    props.organizerName && props.organizerEmail
      ? sql.concat(
        foldLine(
          sql.concat(
            "ORGANIZER;CN=",
            escapedOrganizerName,
            ":MAILTO:",
            props.organizerEmail,
          ),
        ),
        "\r\n",
      )
      : "",
    props.inviteeName && props.inviteeEmail && !props.downloading
      ? sql.concat(
        foldLine(
          sql.concat(
            "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN=",
            escapedInviteeName,
            ":MAILTO:",
            props.inviteeEmail,
          ),
        ),
        "\r\n",
      )
      : "",
    "SEQUENCE:0\r\n",
    "BEGIN:VALARM\r\n",
    "TRIGGER:-PT15M\r\n",
    "ACTION:DISPLAY\r\n",
    "DESCRIPTION:Reminder\r\n",
    "END:VALARM\r\n",
    "END:VEVENT\r\n",
    "END:VCALENDAR",
  );
}

/**
 * Menu button that exposes "Add to Google Calendar", "Add to Outlook",
 * and "Download .ics" options for the event described by `props`.
 */
export function AddToCalendarButton(props: AddToCalendarProps) {
  // Format dates for Google Calendar (remove '-', ':' and convert to UTC)
  const googleStart =
    sql`regex.replace_all(date.to_rfc3339(${props.startTime}, 'seconds', true), '-|:', '')`;
  const googleEnd =
    sql`regex.replace_all(date.to_rfc3339(${props.endTime}, 'seconds', true), '-|:', '')`;

  const googleParams = queryParamsString({
    action: sql.lit`TEMPLATE`,
    text: props.title,
    details: props.description,
    location: props.location,
    dates: sql.concat(googleStart, "/", googleEnd),
  });

  // Outlook uses standard RFC3339
  const outlookParams = queryParamsString({
    path: sql.lit`/calendar/action/compose`,
    rru: sql.lit`addevent`,
    subject: props.title,
    body: props.description,
    location: props.location,
    startdt: sql`date.to_rfc3339(${props.startTime}, 'seconds', true)`,
    enddt: sql`date.to_rfc3339(${props.endTime}, 'seconds', true)`,
  });

  const getICalContent = formatAsICal({
    title: props.title,
    description: props.description,
    startTime: props.startTime,
    endTime: props.endTime,
    location: props.location,
    uniqueId: sql`uid`,
    downloading: props.downloading,
  });

  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("uid", sql`random.uuid()`);
      }}
    >
      <Menu>
        <Menu.Button
          startIcon="InsertInvitation"
          sx={props.sx}
          size={props.size}
          variant={props.variant}
          color={props.color}
        >
          Add to Calendar
        </Menu.Button>
        <Menu.Content>
          <Menu.Item
            onClick={(s) => {
              s.window.open(
                sql.concat(
                  sql.lit`https://calendar.google.com/calendar/render?`,
                  googleParams,
                ),
                sql.lit`blank`,
              );
            }}
          >
            Google Calendar
          </Menu.Item>
          <Menu.Item
            onClick={(s) => {
              // TODO: add mime type of text/calendar
              // need to add first to the download statement in rust
              s.download(
                sql.concat(props.title, sql.lit`.ics`),
                getICalContent,
              );
            }}
          >
            Apple Calendar
          </Menu.Item>
          <Menu.Item
            onClick={(s) => {
              s.window.open(
                sql.concat(
                  sql
                    .lit`https://outlook.office.com/calendar/0/deeplink/compose?`,
                  outlookParams,
                ),
                sql.lit`blank`,
              );
            }}
          >
            Outlook
          </Menu.Item>
          <Menu.Item
            onClick={(s) => {
              s.download(
                sql.concat(props.title, sql.lit`.ics`),
                getICalContent,
              );
            }}
          >
            Other (iCal)
          </Menu.Item>
        </Menu.Content>
      </Menu>
    </Data>
  );
}
