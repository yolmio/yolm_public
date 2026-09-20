import type { SchedulingProviderHost } from "blocks/scheduling/provider_host";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type {
  DomStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import type { Style } from "std/style_types";
import { system, useBlock } from "std/system";
import type { App, Block } from "std/system";
import type { Node } from "std/ui";

export interface CreateMeetingOpts {
  userId: NumericExpr;
  eventTypeId?: NumericExpr;
  topic: Sql;
  startTime: Sql;
  duration: NumericExpr; // in minutes
  meetingIdScalar: string;
  meetingUrlScalar: string;
  timeZone?: Sql;
  meetingPasswordScalar: string;
}

export interface DeleteMeetingOpts {
  userId: NumericExpr;
  meetingId: Sql;
}

export interface UpdateMeetingOpts {
  userId: NumericExpr;
  meetingId: Sql;
  topic: Sql;
  startTime: Sql;
  duration: NumericExpr;
  timezone: Sql;
}

export interface DeleteAccountOpts {
  accountId: Sql;
}

/**
 * Interface every meeting-provider integration implements (Zoom, Teams,
 * Google Meet, etc.). Implementations own their own OAuth flow, per-user
 * account table, and the create / update / delete methods used by the
 * scheduling system.
 *
 * Implementations register themselves as a {@link Block} on the system.
 */
export interface MeetingIntegration extends Block {
  /** Create a meeting on the provider and populate the requested scalars. */
  createMeeting<T extends IServerBaseStatements>(
    s: T,
    opts: CreateMeetingOpts,
  ): void;

  /** Delete a meeting from the provider. */
  deleteMeeting<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteMeetingOpts,
  ): void;
  /** Update an existing meeting on the provider. */
  updateMeeting<T extends IServerBaseStatements>(
    s: T,
    opts: UpdateMeetingOpts,
  ): void;

  /** Register the OAuth redirect endpoint on `app`. */
  addOauthRedirect(app: App): void;
  /**
   * The integration name needs to match the enum value in the database
   * for the `location` field in the `scheduling_event_types` table.
   */
  integrationName: string;
  /** Encryption key used to encrypt persisted refresh tokens. */
  encryptionKey: string;
  /** Statements that navigate the user to the provider's OAuth flow. */
  navigateToOauth: (s: DomStatements) => void;
  /** Icon rendered in account-picker UI. */
  icon: (props: { sx?: Style; className?: string }) => Node;
  /** Inline display node for a connected account. */
  accountDisplay: Node;
  /** SQL expression yielding `true` when an account row is currently active. */
  isActiveAccount: BooleanExpr;
  /** Delete the per-user account row referenced by `opts.accountId`. */
  deleteAccount<T extends IServerBaseStatements>(
    s: T,
    opts: DeleteAccountOpts,
  ): void;
  /** Name of the per-user account table. */
  accountTable: string;
}

/** Constructor signature for a {@link MeetingIntegration} implementation. */
export type MeetingIntegrationConstructor = new (
  ...args: any[]
) => MeetingIntegration;

/*
  This function iterates over all the meeting integrations and creates a meeting for each one.
  If isUpdate is true, it will delete the existing meeting and create a new one.
  If isUpdate is false, it will simply create a new meeting.
*/
export function iterateOverIntegrationsAndCreateMeeting({
  s,
  appointmentTable,
  topic,
  startTime,
  duration,
  userId,
  eventTypeId,
  isUpdate,
  appointmentId,
}: {
  s: UiServerStatements;
  appointmentTable: string;
  topic: Sql;
  startTime: Sql;
  duration: Sql;
  userId: Sql;
  eventTypeId: Sql;
  isUpdate: boolean;
  appointmentId: Sql;
}) {
  const schedulingBlock = system.blockNamed<SchedulingProviderHost>(
    "SchedulingBlock",
  );
  const meetingIntegrations = schedulingBlock?.opts.meetingIntegrations ?? [];
  if (meetingIntegrations.length === 0) {
    return;
  }
  const runtimeAppointments = schedulingBlock.runtimeAppointments;
  if (!runtimeAppointments) {
    throw new Error(
      "Runtime appointment callbacks are required for this booking form",
    );
  }
  s.defScalar("id_scalar", {
    type: { type: "String", maxLength: 255 },
  });
  s.defScalar("url_scalar", {
    type: { type: "String", maxLength: 255 },
  });
  s.defScalar("password_scalar", {
    type: { type: "String", maxLength: 255 },
  });
  for (const meetingIntegration of meetingIntegrations) {
    const block = useBlock(meetingIntegration.integration);
    if (!meetingIntegration.addToMeeting) continue;
    const location = block.integrationName.toLowerCase().replaceAll(" ", "_");
    const oldMeetingIdScalar = `${meetingIntegration.meetingIdField}_old_id`;
    s.if(
      sql`${
        runtimeAppointments.getEffectiveMeetingLocation({ eventTypeId, userId })
      } = ${sql.lit(location)}`,
      (s) => {
        s.defScalar(oldMeetingIdScalar, {
          type: { type: "String", maxLength: 255 },
          expr: sql`(select ${
            sql.ref(meetingIntegration.meetingIdField)
          } from db.${sql.ref(appointmentTable)} where id = ${appointmentId})`,
        });
        block.createMeeting(s, {
          userId: userId,
          meetingIdScalar: "id_scalar",
          eventTypeId: eventTypeId,
          topic: topic,
          startTime: startTime,
          duration: duration,
          meetingUrlScalar: "url_scalar",
          timeZone: sql`date.part(timezone, ${startTime})`,
          meetingPasswordScalar: "password_scalar",
        });
        s.startTransaction();
        s.modify(
          sql`update db.${sql.ref(appointmentTable)} set ${
            sql.ref(meetingIntegration.meetingIdField)
          } = id_scalar,
          ${
            sql.ref(meetingIntegration.meetingIdField)
          }_join_url = url_scalar, ${
            sql.ref(meetingIntegration.meetingIdField)
          }_password = crypto.encrypt(password_scalar, ${
            sql.lit(block.encryptionKey)
          }) where id = ${appointmentId}`,
        );
        s.commitTransaction();

        s.if(
          sql`${isUpdate} and ${sql.ref(oldMeetingIdScalar)} is not null`,
          (s) => {
            block.deleteMeeting(s, {
              userId,
              meetingId: sql`${sql.ref(oldMeetingIdScalar)}`,
            });
          },
        );
      },
    );
  }
}
