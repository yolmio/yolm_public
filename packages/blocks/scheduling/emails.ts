import { sql } from "../../std/sql_utils";
import type { Sql } from "../../std/sql_utils";

export function normalizeSchedulingPath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  const withoutTrailingSlashes = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlashes || "/";
}

export function appendSchedulingPath(path: string, suffix: string): string {
  const normalized = normalizeSchedulingPath(path);
  return `${normalized === "/" ? "" : normalized}/${suffix}`;
}

export function inviteeEmailFooter({
  icsUrl,
  rescheduleUrl,
  cancelUrl,
}: {
  icsUrl?: Sql;
  rescheduleUrl: Sql;
  cancelUrl: Sql;
}) {
  const addButton = icsUrl
    ? sql.concatTemplate`
    <mj-section padding="20px 20px 10px 20px">
      <mj-column>
        <mj-button
          align="center"
          href="${icsUrl}"
          background-color="#346DB7"
          inner-padding="12px 24px"
          border-radius="6px"
        >
          Add to Calendar
        </mj-button>
      </mj-column>
    </mj-section>
  `
    : "";
  return sql.concatTemplate`
    <mj-section padding="0">
      <mj-column>
        <mj-divider border-width="1px" border-color="#E0E0E0" padding="0" />
      </mj-column>
    </mj-section>
    ${addButton}
    <mj-section padding="10px 20px 0px 20px">
      <mj-column>
        <mj-text
          color="#666666"
          font-size="13px"
          align="center"
          font-weight="bold"
          padding="0"
        >
          Make changes to this event:
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding-top="4px">
      <mj-group>
        <mj-column>
          <mj-button
            href="${rescheduleUrl}"
            background-color="transparent"
            border="1px solid #666666"
            color="#666666"
            font-size="13px"
            align="right"
            width="130px"
            padding-right="4px"
          >
            Reschedule
          </mj-button>
        </mj-column>
        <mj-column>
          <mj-button
            href="${cancelUrl}"
            background-color="transparent"
            border="1px solid #666666"
            color="#666666"
            font-size="13px"
            align="left"
            width="130px"
            padding-left="4px"
          >
            Cancel
          </mj-button>
        </mj-column>
      </mj-group>
    </mj-section>
  `;
}

export function inviteeEmailWithFooter({
  title,
  body,
  icsUrl,
  rescheduleUrl,
  cancelUrl,
  schedulingDomain,
  schedulingPath,
  appointmentRecord,
}: {
  title: Sql;
  body: Sql;
  icsUrl?: Sql;
  rescheduleUrl?: Sql;
  cancelUrl?: Sql;
  schedulingDomain?: string;
  schedulingPath?: string;
  appointmentRecord?: Sql;
}) {
  if (
    schedulingDomain && schedulingPath !== undefined && appointmentRecord
  ) {
    const appointmentPath = appendSchedulingPath(schedulingPath, "");
    if (!rescheduleUrl) {
      rescheduleUrl = sql.concat(
        "https://",
        schedulingDomain,
        appointmentPath,
        sql`${appointmentRecord}.public_id`,
        "/reschedule",
      );
    }
    if (!cancelUrl) {
      cancelUrl = sql.concat(
        "https://",
        schedulingDomain,
        appointmentPath,
        sql`${appointmentRecord}.public_id`,
        "/cancel",
      );
    }
  }
  if (!(rescheduleUrl && cancelUrl)) {
    throw new Error(
      "rescheduleUrl and cancelUrl must be provided if schedulingDomain and schedulingPath are not provided",
    );
  }
  return sql.concatTemplate`
<mjml>
  <mj-head>
    <mj-title>Appointment ${title}</mj-title>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
      <mj-text font-size="14px" line-height="1.5" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    ${body}
    ${inviteeEmailFooter({ icsUrl, rescheduleUrl, cancelUrl })}
  </mj-body>
</mjml>`;
}
