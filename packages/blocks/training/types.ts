import type { UserNotificationSource } from "blocks/user_notifications";
import type { WorkforceProvider } from "blocks/workforce";
import type { TrainingDriveExtension } from "./drive_documents.tsx";

export interface TrainingCertificateTemplateOpts {
  organizationName?: string;
  approvalLabel?: string;
  logoPath?: string;
  sealPath?: string;
}

export interface TrainingRetrainingSourceOpts {
  code: string;
  name: string;
  description?: string;
}

export interface TrainingPersonnelDocumentTypeOpts {
  code: string;
  name: string;
}

export type TrainingFeatureName =
  | "inviteAccess"
  | "compliance"
  | "courseIntroduction";

export interface TrainingInviteAccessFeatureOpts {
  enabled?: boolean;
}

export interface TrainingComplianceFeatureOpts {
  enabled?: boolean;
}

export interface TrainingFeatureConfig {
  inviteAccess?: TrainingInviteAccessFeatureOpts;
  compliance?: TrainingComplianceFeatureOpts;
  /** Optional course introduction editor and learner view. Defaults to disabled. */
  courseIntroduction?: { enabled?: boolean };
}

export interface TrainingRouteOpts {
  /** Admin route prefix. Defaults to `/training-admin`. */
  adminBasePath?: string;
  /** Authenticated employee route prefix. Defaults to `/training`. */
  employeeBasePath?: string;
  /** Login-free invite route prefix. Defaults to `/training`. */
  accessBasePath?: string;
}

export interface TrainingBlockOpts {
  content: TrainingDriveExtension;
  notifications: UserNotificationSource;
  workforce: WorkforceProvider;
  /**
   * Statement an employee must affirm before signing a training task. The
   * exact statement is snapshotted onto the completed task.
   */
  completionAttestation?: string;
  /** Immutable retraining sources. Required when compliance is enabled. */
  retrainingSources?: readonly TrainingRetrainingSourceOpts[];
  /** Immutable personnel document types. Required when compliance is enabled. */
  personnelDocumentTypes?: readonly TrainingPersonnelDocumentTypeOpts[];
  routes?: TrainingRouteOpts;
  /**
   * Domain of the login-free access portal app. Assignment invite links are
   * built as `https://<accessDomain><accessBasePath>/invite/<token>`.
   * Required to produce invite links when invite access is enabled.
   */
  accessDomain?: string;
  /**
   * Optional features, all disabled unless explicitly enabled.
   * Compliance and invite access control their backing schema and routes/jobs.
   * Course introductions retain stored content when disabled, but hide their
   * UI and disable editing and image access.
   */
  features?: TrainingFeatureConfig;
  labels?: {
    validation?: {
      primaryStageDisplayName?: string;
      primaryStageSignatureLabel?: string;
      secondaryStagePermission?: string;
      secondaryStageDisplayName?: string;
      secondaryStageSignatureLabel?: string;
      validatorGenericLabel?: string;
    };
  };
  /**
   * Default for new courses. Individual course records can still override it.
   * Defaults to false.
   */
  defaultCourseRequiresFinalSignature?: boolean;
  /**
   * Default for new courses when compliance/personnel is enabled. Individual
   * course records can still override it. Defaults to false.
   */
  defaultCourseGeneratesCertification?: boolean;
  certificationTemplate?: TrainingCertificateTemplateOpts;
  /**
   * Controls who can sign the secondary course validation stage. Defaults to
   * `selected_person`, which requires the employee-selected secondary
   * validator to sign. `anyone_with_permission` lets any current user with
   * the secondary-stage permission sign.
   */
  secondaryValidatorSignoff?: "selected_person" | "anyone_with_permission";
}
