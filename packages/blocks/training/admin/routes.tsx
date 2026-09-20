import { Alert } from "components/alert";
import { AuthBlock } from "blocks/auth";
import { sql } from "std/sql_utils";
import { type Node, Route } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import { trainingPermissions } from "../helpers";
import {
  EmployeePersonnelFilePage,
  EmployeeTrainingCoursePage,
} from "../employee_portal_routes";
import { TrainingAdminAssessmentPage } from "./assessment_editor";
import {
  TrainingAdminAssessmentReviewsPage,
  TrainingAdminAssessmentTaskPage,
} from "./assessment_reviews";
import { TrainingAdminAssessmentsPage } from "./assessments";
import { TrainingAdminAudiencesPage } from "./audiences";
import { TrainingAdminCourseAssignPage } from "./course_assignment";
import { TrainingAdminCoursePage } from "./course_editor";
import { TrainingAdminCourseValidationsPage } from "./course_validations";
import { TrainingAdminCoursesPage } from "./courses";
import { TrainingAdminDashboardPage } from "./dashboard";
import { TrainingAdminPeoplePage } from "./employees";
import { TrainingAdminNotificationsPage } from "./notifications";
import { TrainingAdminSectionTemplatesPage } from "./section_templates";
import {
  adminEmployeeCourseValidationHref,
  adminEmployeeHref,
  TrainingAdminFrame,
} from "./shared";

export function TrainingAdminRoutes(
  props: { block: TrainingBlock },
) {
  const base = props.block.opts.routes?.adminBasePath ?? "/training-admin";
  const rootPath = base === "" ? "/" : base;
  const childPath = (path: string) => base === "" ? path : `${base}${path}`;
  const permissions = trainingPermissions;
  const adminPermissions = Object.values(permissions);
  const requirePermission = (permission: string, children: Node) => (
    <AuthBlock.PermissionCheck
      permission={permission}
      fallback={
        <TrainingAdminFrame>
          <Alert color="danger" startIcon="Lock">
            You do not have permission to access this training area.
          </Alert>
        </TrainingAdminFrame>
      }
    >
      {children}
    </AuthBlock.PermissionCheck>
  );
  const requireAnyPermission = (permissions: string[], children: Node) => (
    <AuthBlock.PermissionCheckAny
      permissions={permissions}
      fallback={
        <TrainingAdminFrame>
          <Alert color="danger" startIcon="Lock">
            You do not have permission to access this training area.
          </Alert>
        </TrainingAdminFrame>
      }
    >
      {children}
    </AuthBlock.PermissionCheckAny>
  );
  return (
    <>
      <Route path={childPath("/dashboard")}>
        {requireAnyPermission(
          adminPermissions,
          <TrainingAdminDashboardPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/courses/{course_id:id}/assign")}>
        {requirePermission(
          permissions.assignTraining,
          <TrainingAdminCourseAssignPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/courses/{course_id:id}")}>
        {requirePermission(
          permissions.manageLibrary,
          <TrainingAdminCoursePage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/courses")}>
        {requirePermission(
          permissions.manageLibrary,
          <TrainingAdminCoursesPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/course-validations")}>
        {requirePermission(
          permissions.validateTraining,
          <TrainingAdminCourseValidationsPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/sections")}>
        {requirePermission(
          permissions.manageLibrary,
          <TrainingAdminSectionTemplatesPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/assessments/{assessment_id:id}")}>
        {requirePermission(
          permissions.manageAssessments,
          <TrainingAdminAssessmentPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/assessments")}>
        {requirePermission(
          permissions.manageAssessments,
          <TrainingAdminAssessmentsPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/assessment-reviews")}>
        {requireAnyPermission(
          [
            permissions.reviewAssessments,
            permissions.recordEvaluations,
            permissions.overrideAssessmentOutcomes,
          ],
          <TrainingAdminAssessmentReviewsPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/assessment-tasks/{training_task_id:id}")}>
        {requireAnyPermission(
          [
            permissions.reviewAssessments,
            permissions.recordEvaluations,
            permissions.overrideAssessmentOutcomes,
          ],
          <TrainingAdminAssessmentTaskPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/notifications")}>
        {requirePermission(
          permissions.manageNotifications,
          <TrainingAdminNotificationsPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/audiences")}>
        {requirePermission(
          permissions.manageDocumentSettings,
          <TrainingAdminAudiencesPage block={props.block} />,
        )}
      </Route>
      <Route path={childPath("/people")}>
        {requirePermission(
          permissions.viewEmployeeFiles,
          <TrainingAdminPeoplePage block={props.block} />,
        )}
      </Route>
      <Route
        path={childPath(
          "/employee/{person_id:id}/course-validations/{training_assignment_id:id}",
        )}
      >
        {requireAnyPermission(
          [permissions.viewEmployeeFiles, permissions.validateTraining],
          (
            <EmployeeTrainingCoursePage
              block={props.block}
              personId={sql`ui.person_id`}
              backHref={adminEmployeeHref(props.block, sql`ui.person_id`)}
              backLabel="Back to employee"
              validationMode
            />
          ),
        )}
      </Route>
      <Route path={childPath("/employee/{person_id:id}")}>
        {requirePermission(
          permissions.viewEmployeeFiles,
          (
            <EmployeePersonnelFilePage
              block={props.block}
              courseValidationHref={(employeeId, assignmentId) =>
                adminEmployeeCourseValidationHref(
                  props.block,
                  employeeId,
                  assignmentId,
                )}
            />
          ),
        )}
      </Route>
      <Route path={rootPath}>
        {requireAnyPermission(
          adminPermissions,
          <TrainingAdminDashboardPage block={props.block} />,
        )}
      </Route>
    </>
  );
}
