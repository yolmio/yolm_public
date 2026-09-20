import type { NumericExpr } from "../../std/sql_utils";
import type { AnyExpr } from "../../std/sql_utils";
import { sql } from "../../std/sql_utils";
import type { UiServerStatements } from "std/statements";
import type { Node } from "std/ui";
import type { FormContext } from "std/form";
import { DevCancelPage } from "./dev_cancel_page";
import { DevReschedulingPage, DevSchedulingPage } from "./dev_scheduling_page";
import { appendSchedulingPath, normalizeSchedulingPath } from "./emails";

export interface DevDefinedSchedulingPages {
  type: string;
  /**
       This is the path for the scheduling page.

       Reschedule will be [basePath]/reschedule/[appointmentId]
       Cancel will be [basePath]/cancel/[appointmentId]
       */
  basePath: string;
  description?: Node;
  form: Node;
  poweredByYolm?: boolean;
  scheduling?: {
    insertValues?: Record<string, AnyExpr>;
    afterTransactionStart?: (s: UiServerStatements, ctx: FormContext) => void;
    beforeTransactionCommit?: (
      s: UiServerStatements,
      createdAppointmentId: NumericExpr,
    ) => void;
    afterTransactionCommit?: (
      s: UiServerStatements,
      createdAppointmentId: NumericExpr,
    ) => void;
  };
  backgroundColorOverride?: string;
}

export function DevDefinedSchedulingPages(props: DevDefinedSchedulingPages) {
  const basePath = normalizeSchedulingPath(props.basePath);
  return (
    <>
      <DevSchedulingPage
        path={basePath}
        devDefinedEventType={props.type}
        description={props.description}
        form={props.form}
        backgroundColorOverride={props.backgroundColorOverride}
        {...props.scheduling}
      />
      <DevCancelPage
        devDefinedEventType={props.type}
        path={appendSchedulingPath(
          basePath,
          "{cancel_appointment_public_id:uuid}/cancel",
        )}
        appointmentPublicId={sql`ui.cancel_appointment_public_id`}
      />
      <DevReschedulingPage
        path={appendSchedulingPath(
          basePath,
          "{reschedule_appointment_public_id:uuid}/reschedule",
        )}
        appointmentPublicId={sql`ui.reschedule_appointment_public_id`}
        devDefinedEventType={props.type}
        description={props.description}
        form={props.form}
        {...props.scheduling}
      />
    </>
  );
}
