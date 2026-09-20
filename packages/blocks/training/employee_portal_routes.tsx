import { Alert } from "components/alert";
import { Button } from "components/button";
import { Card, CardContent, CardHeader } from "components/card";
import { Sidebar } from "components/sidebar";
import { Checkbox } from "components/checkbox";
import { Chip } from "components/chip";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { IconButton } from "components/icon_button";
import { Input } from "components/input";
import { LexicalRichTextDisplay } from "components/lexical/components/lexical_editor";
import { MaterialIcon } from "components/material_icon";
import { ModalDialog } from "components/modal";
import { QueryCombobox } from "components/query_combobox";
import { Select } from "components/select";
import { StatusChip } from "components/status_chip";
import { Textarea } from "components/textarea";
import { Typography } from "components/typography";
import { currentUserHasPermission, userHasPermission } from "blocks/auth";
import { Data } from "std/data";
import { Form } from "std/form";
import type { FormFieldHelper } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { DomStatements, UiServerStatements } from "std/statements";
import { visuallyHiddenStyles } from "std/style_utils";
import { Each, Effect, Route, Show } from "std/ui";

import type { TrainingBlock } from "./index.tsx";
import {
  deleteAssessmentChoiceSelectionSql,
  insertAssessmentChoiceSelectionSql,
  selectAssessmentSingleChoiceSql,
} from "./assessment_helpers";
import {
  assignmentInviteLinkSql,
  certificationProofUrl,
  certificationWarningDaysSql,
  competencyAlertWhereSql,
  competencyEvidenceUrl,
  createCertificationForCompletedAssignment,
  currentEmployeeId,
  defaultLanguageSql,
  employeeName,
  employeeText,
  formatDateSql,
  formatDateTimeSql,
  generatedCertificateDownloadUrl,
  generatedCertificateUrl,
  openTrainingAssignmentWhereSql,
  personLanguageSql,
  personnelDocumentTypeWithFallbackSql,
  personnelDocumentUrl,
  personTable,
  relativeDueSql,
  retrainingSourceSql,
  retrainingSourceWithFallbackSql,
  revokeTrainingAccessTokensForClosedAssignmentSql,
  secondaryValidatorSignoffByPermission,
  trainingCompletionAttestation,
  trainingComplianceLabels,
  trainingExternalVersionUrl,
  trainingFeatureEnabled,
  trainingFileVersionUrl,
  trainingPermissions,
  trainingValidationLabels,
  updateAssignmentStatusAfterTaskCompletionSql,
} from "./helpers";
import {
  callSaveAssessmentMetadataResponse,
  callSaveAssessmentResponse,
  EmptyState,
  FormFieldWithLabel,
  PageShell,
  SignaturePad,
  StatTile,
} from "./shared";

/**
 * One validator sign-off card for the course validation panel. Renders the
 * stage's validator, the recorded state, and — for the eligible signer — a
 * signature pad that records the attestation through the
 * `training_record_assignment_validation` stored procedure. Reads the
 * `course_assignment` record of the enclosing course page.
 */
function ValidatorSignoffCard(
  props: { block: TrainingBlock; stage: "primary" | "secondary" },
) {
  const validationLabels = trainingValidationLabels(props.block.opts);
  const secondaryByPermission = secondaryValidatorSignoffByPermission(
    props.block.opts,
  );
  const isPrimary = props.stage === "primary";
  const displayName = isPrimary
    ? validationLabels.primaryStageDisplayName
    : validationLabels.secondaryStageDisplayName;
  const validatorNameSql = isPrimary
    ? sql`coalesce(course_assignment.final_primary_validator_name, 'Not selected')`
    : secondaryByPermission
    ? sql`coalesce(course_assignment.final_secondary_validator_name, 'Any eligible signer')`
    : sql`coalesce(course_assignment.final_secondary_validator_name, 'Not selected')`;
  return (
    <div className="p-3 rounded-md bg-white border border-divider">
      <Typography level="body-sm" className="text-neutral-600">
        {displayName}
      </Typography>
      <Typography level="title-sm">
        {validatorNameSql}
      </Typography>
      <Show
        when={isPrimary
          ? sql`course_assignment.primary_validator_validated`
          : sql`course_assignment.secondary_validator_validated`}
        fallback={
          <Show
            when={isPrimary
              ? sql`course_assignment.current_user_is_primary_validator`
              : sql`course_assignment.current_user_is_secondary_validator`}
          >
            <div className="mt-3">
              <SignaturePad
                label={isPrimary
                  ? validationLabels.primaryStageSignatureLabel
                  : validationLabels.secondaryStageSignatureLabel}
                onSigned={(s, signatureData) => {
                  s.setScalar("validation_error", sql`null`);
                  s.tryServer({
                    body: (s) => {
                      s.startTransaction();
                      s.callStoredProcedure(
                        "training_record_assignment_validation",
                        {
                          inputScalars: {
                            p_assignment_id: sql`course_assignment.id`,
                            p_stage: sql.lit(props.stage),
                            p_signature_data: signatureData,
                          },
                        },
                      );
                      s.commitTransaction();
                      s.refetch();
                    },
                    errorName: "assignment_validation_failure",
                    catch: (s) =>
                      s.setScalar(
                        "validation_error",
                        sql`coalesce(
                          assignment_validation_failure.message,
                          'The validation could not be recorded.'
                        )`,
                      ),
                  });
                }}
              />
            </div>
          </Show>
        }
      >
        <Chip size="sm" variant="soft" color="success" className="mt-2">
          Validated
        </Chip>
      </Show>
    </div>
  );
}

function employeeBasePath(block: TrainingBlock, accessToken?: Sql) {
  return accessToken
    ? block.opts.routes?.accessBasePath ?? "/training"
    : block.opts.routes?.employeeBasePath ?? "/training";
}

function employeeTrainingHref(block: TrainingBlock) {
  return sql.lit`${employeeBasePath(block) || "/"}`;
}

function employeeHomeHref(block: TrainingBlock, accessToken?: Sql) {
  const basePath = employeeBasePath(block, accessToken);
  return accessToken
    ? sql`${sql.lit(basePath)} || '/invite/' || ${accessToken}`
    : employeeTrainingHref(block);
}

function employeeTaskHref(
  block: TrainingBlock,
  taskId: Sql,
  accessToken?: Sql,
) {
  const basePath = employeeBasePath(block, accessToken);
  return accessToken
    ? sql`${
      sql.lit(basePath)
    } || '/invite/' || ${accessToken} || '/tasks/' || ${taskId}`
    : sql`${sql.lit(basePath)} || '/tasks/' || ${taskId}`;
}

function employeeCourseHref(
  block: TrainingBlock,
  assignmentId: Sql,
  accessToken?: Sql,
) {
  const basePath = employeeBasePath(block, accessToken);
  return accessToken
    ? sql`${
      sql.lit(basePath)
    } || '/invite/' || ${accessToken} || '/courses/' || ${assignmentId}`
    : sql`${sql.lit(basePath)} || '/courses/' || ${assignmentId}`;
}

function employeeAssessmentHref(
  block: TrainingBlock,
  taskId: Sql,
  accessToken?: Sql,
) {
  const basePath = employeeBasePath(block, accessToken);
  return accessToken
    ? sql`${
      sql.lit(basePath)
    } || '/invite/' || ${accessToken} || '/assessments/' || ${taskId}`
    : sql`${sql.lit(basePath)} || '/assessments/' || ${taskId}`;
}

function employeeDocumentsHref(block: TrainingBlock, accessToken?: Sql) {
  const basePath = employeeBasePath(block, accessToken);
  return accessToken
    ? sql`${sql.lit(basePath)} || '/invite/' || ${accessToken} ||
      '/documents'`
    : sql.lit(block.opts.content.readerLibraryHref());
}

function TrainingDocumentFormControl(props: { helper: FormFieldHelper }) {
  return (
    <Data
      watch={[props.helper.value]}
      procedure={(s) => {
        s.defScalar(
          "training_document_form_label",
          sql`coalesce((
            select document.title
            from db.training_content_documents document
            where document.id = ${props.helper.value}
          ), '')`,
        );
      }}
    >
      <QueryCombobox
        placeholder="Search published documents..."
        clearOnSelect={false}
        initialInputText={sql`training_document_form_label`}
        error={props.helper.hasError}
        populateResultTable={(s, query, resultTable) => {
          s.modify(sql`
            insert into ${resultTable}
              select document.title as label,
                     rank() over () - 1 as index,
                     document.id
              from db.training_content_documents document
              where document.is_active
                and exists (
                  select 1
                  from db.training_content_language_variants variant
                  where variant.document_id = document.id
                    and variant.current_document_version_id is not null
                )
                and (
                  trim(${query}) = ''
                  or fuzzy_match(${query}, document.title)
                )
              order by
                case when trim(${query}) = '' then 0 else 1 end,
                fuzzy_rank_key(${query}, document.title),
                document.title
              limit 50
          `);
        }}
        onSelect={(s, result) => props.helper.setValue(s, sql`${result}.id`)}
        onClear={(s) => props.helper.setValue(s, sql`null`)}
        onBlur={() => {}}
      />
    </Data>
  );
}

function trainingNativeImageSrcPrefixRewrite(
  versionId: Sql,
  taskId: Sql,
  accessToken?: Sql,
) {
  return {
    prefix: sql.lit`/api/files/native-images/`,
    replacement: accessToken
      ? sql`${sql.lit("/api/training/invite/")} ||
        ${accessToken} || '/tasks/' ||
        ${taskId}::string || '/documents/' ||
        ${versionId}::string || '/native-images/'`
      : sql`${sql.lit("/api/training/tasks/")} ||
        ${taskId}::string || '/documents/' ||
        ${versionId}::string || '/native-images/'`,
  };
}

function EmployeeCertificatesPage(props: { block: TrainingBlock }) {
  const block = props.block;
  return (
    <Data
      procedure={(s) => {
        s.defScalar("person_id", currentEmployeeId(block.opts));
        s.defScalar(
          "employee_language",
          sql`coalesce(
            (
              select language.code
              from db.${sql.ref(personTable(block.opts))} e
              join db.training_content_languages language
                on language.code = ${personLanguageSql(block.opts, sql`e`)}
              where e.id = ui.person_id
            ),
            ${defaultLanguageSql(block.opts)}
          )`,
        );
        s.defTable(
          "certificates",
          sql`select c.id,
                     c.name,
                     c.issued_at,
                     c.expires_at,
                     c.access_token,
                     c.issuing_authority
              from db.training_certifications c
              where c.person_id = ui.person_id
                and c.training_assignment_id is not null
                and c.approval_status = 'approved'
              order by c.issued_at desc nulls last, c.id desc`,
        );
      }}
    >
      <PageShell
        title={employeeText(sql`employee_language`, {
          en: "My Certificates",
          es: "Mis Certificados",
        })}
        subtitle={employeeText(sql`employee_language`, {
          en: "Certificates earned from completed eligible courses.",
          es: "Certificados obtenidos de cursos elegibles completados.",
        })}
      >
        <Card variant="outlined">
          <CardContent>
            <Show when={sql`not exists (select 1 from certificates)`}>
              <EmptyState
                icon="Badge"
                title={employeeText(sql`employee_language`, {
                  en: "No certificates yet",
                  es: "Aún no hay certificados",
                })}
                body={employeeText(sql`employee_language`, {
                  en:
                    "Certificates for completed eligible courses will appear here.",
                  es:
                    "Los certificados de cursos elegibles completados aparecerán aquí.",
                })}
              />
            </Show>
            <div className="grid gap-2">
              <Each table="certificates" recordName="certificate">
                <div className="p-3 border border-divider rounded-md bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <Typography level="title-sm">
                      {sql`certificate.name`}
                    </Typography>
                    <Typography level="body-sm" className="text-neutral-600">
                      {employeeText(sql`employee_language`, {
                        en: "Issued",
                        es: "Emitido",
                      })} {formatDateSql(sql`certificate.issued_at`)}
                      <Show when={sql`certificate.expires_at is not null`}>
                        {sql`' · '`}
                        {employeeText(sql`employee_language`, {
                          en: "Expires",
                          es: "Vence",
                        })} {formatDateSql(sql`certificate.expires_at`)}
                      </Show>
                    </Typography>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      component="a"
                      href={generatedCertificateUrl(
                        sql`certificate.access_token`,
                      )}
                      target="_blank"
                      size="sm"
                      variant="outlined"
                      color="primary"
                      startIcon="OpenInNew"
                    >
                      {employeeText(sql`employee_language`, {
                        en: "Open",
                        es: "Abrir",
                      })}
                    </Button>
                    <Button
                      component="a"
                      href={generatedCertificateDownloadUrl(
                        sql`certificate.access_token`,
                      )}
                      size="sm"
                      variant="plain"
                      color="neutral"
                      startIcon="Download"
                    >
                      {employeeText(sql`employee_language`, {
                        en: "Download",
                        es: "Descargar",
                      })}
                    </Button>
                  </div>
                </div>
              </Each>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    </Data>
  );
}

export function TrainingEmployeeSidebarMenuItems(props: {
  block: TrainingBlock;
  shellLanguage: Sql;
  basePath?: string;
}) {
  const base = props.basePath ??
    props.block.opts.routes?.employeeBasePath ?? "/training";
  const homeHref = base === "" ? "/" : base;
  const documentsHref = props.block.opts.content.readerLibraryHref();
  const documentSubmissionsHref = props.block.opts.content
    .readerSubmissionsHref();
  const certificatesHref = `${base}/certificates`;
  const text = (variants: { en: string; es: string }) =>
    employeeText(props.shellLanguage, variants);
  const complianceEnabled = trainingFeatureEnabled(
    props.block.opts,
    "compliance",
  );
  return (
    <>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton href={homeHref}>
          <MaterialIcon icon="School" className="mr-2" />
          {text({ en: "My Training", es: "Mi Capacitación" })}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton href={documentsHref}>
          <MaterialIcon icon="FolderOpen" className="mr-2" />
          {text({ en: "Documents", es: "Documentos" })}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton href={documentSubmissionsHref}>
          <MaterialIcon icon="PostAdd" className="mr-2" />
          {text({ en: "Manage Policies", es: "Administrar Políticas" })}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      {complianceEnabled && (
        <Sidebar.MenuItem>
          <Sidebar.MenuButton href={certificatesHref}>
            <MaterialIcon icon="Badge" className="mr-2" />
            {text({ en: "My Certificates", es: "Mis Certificados" })}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      )}
    </>
  );
}

export function TrainingEmployeeRoutes(
  props: {
    block: TrainingBlock;
    showPortalNav?: boolean;
  },
) {
  const base = props.block.opts.routes?.employeeBasePath ?? "/training";
  const rootPath = base === "" ? "/" : base;
  const childPath = (path: string) => base === "" ? path : `${base}${path}`;
  const complianceEnabled = trainingFeatureEnabled(
    props.block.opts,
    "compliance",
  );
  const showPortalNav = props.showPortalNav ?? true;
  return (
    <>
      <Route path={rootPath}>
        <EmployeeTrainingHome
          block={props.block}
          showPortalNav={showPortalNav}
        />
      </Route>
      <Route path={childPath("/tasks/{training_task_id:id}")}>
        <EmployeeTrainingTaskPage block={props.block} />
      </Route>
      <Route path={childPath("/assessments/{training_task_id:id}")}>
        <EmployeeAssessmentTaskPage block={props.block} />
      </Route>
      <Route path={childPath("/courses/{training_assignment_id:id}")}>
        <EmployeeTrainingCoursePage block={props.block} />
      </Route>
      {complianceEnabled && (
        <Route path={childPath("/certificates")}>
          <EmployeeCertificatesPage block={props.block} />
        </Route>
      )}
    </>
  );
}

export function TrainingAccessRoutes(
  props: { block: TrainingBlock },
) {
  const base = props.block.opts.routes?.accessBasePath ?? "/training";
  const childPath = (path: string) => base === "" ? path : `${base}${path}`;
  if (!trainingFeatureEnabled(props.block.opts, "inviteAccess")) {
    return <></>;
  }
  return (
    <>
      <Route path={childPath("/invite/{training_access_token}")}>
        <EmployeeTrainingHome
          block={props.block}
          accessToken={sql`ui.training_access_token`}
        />
      </Route>
      <Route
        path={childPath(
          "/invite/{training_access_token}/tasks/{training_task_id:id}",
        )}
      >
        <EmployeeTrainingTaskPage
          block={props.block}
          accessToken={sql`ui.training_access_token`}
        />
      </Route>
      <Route
        path={childPath(
          "/invite/{training_access_token}/assessments/{training_task_id:id}",
        )}
      >
        <EmployeeAssessmentTaskPage
          block={props.block}
          accessToken={sql`ui.training_access_token`}
        />
      </Route>
      <Route
        path={childPath(
          "/invite/{training_access_token}/courses/{training_assignment_id:id}",
        )}
      >
        <EmployeeTrainingCoursePage
          block={props.block}
          accessToken={sql`ui.training_access_token`}
        />
      </Route>
    </>
  );
}

// Shown when an invite token does not resolve to a person, or a task does
// not belong to the viewer. Bilingual because the viewer's language is
// unknown at this point.
function AccessProblemNotice(props: {
  block: TrainingBlock;
  kind: "invite" | "task";
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card variant="outlined" className="max-w-md w-full">
        <CardContent>
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="h-12 w-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center">
              <MaterialIcon icon="LinkOff" className="text-2xl" />
            </div>
            {props.kind === "invite"
              ? (
                <>
                  <Typography level="title-lg">
                    This training link is invalid or has expired
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    Este enlace de capacitación no es válido o ha expirado.
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-700">
                    Ask your training contact for a new link. · Pida un enlace
                    nuevo a su gerente de capacitación.
                  </Typography>
                </>
              )
              : (
                <>
                  <Typography level="title-lg">
                    Training task not found
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    Tarea de capacitación no encontrada.
                  </Typography>
                  <Button
                    component="a"
                    href={employeeTrainingHref(props.block)}
                    variant="outlined"
                    color="neutral"
                    startIcon="ArrowBack"
                    className="mt-2"
                  >
                    Back to My Training · Volver a Mi Capacitación
                  </Button>
                </>
              )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmployeePortalNav(
  props: {
    block: TrainingBlock;
    active: "training" | "documents";
    accessToken?: Sql;
    employeeLanguage: Sql;
  },
) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        component="a"
        href={employeeHomeHref(props.block, props.accessToken)}
        variant={props.active === "training" ? "solid" : "outlined"}
        color={props.active === "training" ? "primary" : "neutral"}
        size="sm"
        startIcon="Assignment"
      >
        {employeeText(props.employeeLanguage, {
          en: "My Training",
          es: "Mi Capacitación",
        })}
      </Button>
      {!props.accessToken && (
        <Button
          component="a"
          href={employeeDocumentsHref(props.block)}
          variant={props.active === "documents" ? "solid" : "outlined"}
          color={props.active === "documents" ? "primary" : "neutral"}
          size="sm"
          startIcon="FolderOpen"
        >
          {employeeText(props.employeeLanguage, {
            en: "Documents",
            es: "Documentos",
          })}
        </Button>
      )}
    </div>
  );
}

function TaskGroupHeader(
  props: { dotClass: string; label: Sql; count: Sql },
) {
  return (
    <div className="flex items-center gap-2 mt-2 first:mt-0">
      <span className={`h-2 w-2 rounded-full shrink-0 ${props.dotClass}`} />
      <Typography
        level="body-xs"
        className="font-semibold uppercase tracking-wider text-neutral-600"
      >
        {props.label}
      </Typography>
      <Typography level="body-xs" className="text-neutral-500">
        {sql`${props.count}::string`}
      </Typography>
    </div>
  );
}

// Renders one open assignment. Expects the home page `open_assignments`
// record scope (record name `assignment`) and the `employee_language`
// scalar. Course assignments render their items inline from
// `open_course_tasks`; document assignments link straight to their task.
function EmployeeAssignmentCard(props: {
  block: TrainingBlock;
  accessToken?: Sql;
}) {
  const titleRow = (
    <div className="flex flex-wrap items-center gap-2">
      <Typography level="title-md">{sql`assignment.title`}</Typography>
      <Chip size="sm" variant="soft" color="neutral">
        {sql`assignment.kind`}
      </Chip>
    </div>
  );
  const dueAndLanguageNotes = (
    <>
      <Show when={sql`assignment.is_overdue`}>
        <Typography
          level="body-sm"
          className="text-danger-700 font-medium mt-0.5"
        >
          {relativeDueSql(sql`employee_language`, sql`assignment.due_date`)}
        </Typography>
      </Show>
      <Show when={sql`assignment.is_due_soon`}>
        <Typography
          level="body-sm"
          className="text-amber-700 font-medium mt-0.5"
        >
          {relativeDueSql(sql`employee_language`, sql`assignment.due_date`)}
        </Typography>
      </Show>
      <Show
        when={sql`assignment.due_date is not null
          and not assignment.is_overdue and not assignment.is_due_soon`}
      >
        <Typography level="body-sm" className="text-neutral-600 mt-0.5">
          {relativeDueSql(sql`employee_language`, sql`assignment.due_date`)}
        </Typography>
      </Show>
      <Show when={sql`assignment.uses_default_language`}>
        <Typography level="body-sm" className="text-amber-700 mt-0.5">
          {employeeText(sql`employee_language`, {
            en:
              "Default-language document assigned because no active translation is published.",
            es:
              "Documento en idioma predeterminado asignado porque no hay una traducción activa publicada.",
          })}
        </Typography>
      </Show>
    </>
  );
  const statusChip = (
    <StatusChip
      fallbackLabel={sql.lit``}
      cases={[
        {
          when: sql`assignment.is_overdue`,
          label: employeeText(sql`employee_language`, {
            en: "Overdue",
            es: "Atrasada",
          }),
          color: "danger",
        },
        {
          when: sql`not assignment.is_overdue
            and assignment.needs_final_signature`,
          label: employeeText(sql`employee_language`, {
            en: "Ready to sign",
            es: "Lista para firmar",
          }),
          color: "warning",
        },
        {
          when: sql`not assignment.is_overdue
            and not assignment.needs_final_signature
            and assignment.started`,
          label: employeeText(sql`employee_language`, {
            en: "In progress",
            es: "En progreso",
          }),
          color: "primary",
        },
        {
          when: sql`not assignment.is_overdue and not assignment.started`,
          label: employeeText(sql`employee_language`, {
            en: "Not started",
            es: "Sin iniciar",
          }),
          color: "neutral",
        },
      ]}
    />
  );
  return (
    <a
      href={sql`case when assignment.is_course then ${
        employeeCourseHref(props.block, sql`assignment.id`, props.accessToken)
      } else ${
        employeeTaskHref(
          props.block,
          sql`assignment.document_task_id`,
          props.accessToken,
        )
      } end`}
      className="block p-4 border border-divider rounded-md bg-white hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {titleRow}
          {dueAndLanguageNotes}
          <Show when={sql`assignment.is_course`}>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 w-32 rounded-full bg-neutral-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{
                    width:
                      sql`(assignment.done_tasks * 100 / greatest(assignment.total_tasks, 1))::string || '%'`,
                  }}
                />
              </div>
              <Typography level="body-xs" className="text-neutral-600">
                {sql`assignment.done_tasks::string || '/' || assignment.total_tasks::string`}
                {" "}
                {employeeText(sql`employee_language`, {
                  en: "steps",
                  es: "pasos",
                })}
              </Typography>
            </div>
          </Show>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {statusChip}
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-700">
            {sql`case when assignment.started then ${
              employeeText(sql`employee_language`, {
                en: "Continue",
                es: "Continuar",
              })
            } else ${
              employeeText(sql`employee_language`, {
                en: "Start",
                es: "Comenzar",
              })
            } end`}
            <MaterialIcon icon="ArrowForward" className="text-base" />
          </span>
        </div>
      </div>
    </a>
  );
}

function EmployeeTrainingHome(
  props: { block: TrainingBlock; accessToken?: Sql; showPortalNav?: boolean },
) {
  const block = props.block;
  const includeCompliance = trainingFeatureEnabled(block.opts, "compliance");
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "person_id",
          props.accessToken
            ? sql`(
              select assignment.person_id
              from db.training_access_tokens access_token
              join db.training_assignments assignment
                on assignment.id = access_token.training_assignment_id
              where access_token.token = ${props.accessToken}
                and access_token.revoked_at is null
                and access_token.expires_at > now()
                and ${openTrainingAssignmentWhereSql(sql`assignment`)}
              limit 1
            )`
            : currentEmployeeId(block.opts),
        );
        s.defScalar(
          "access_assignment_id",
          props.accessToken
            ? sql`(
              select access_token.training_assignment_id
              from db.training_access_tokens access_token
              join db.training_assignments assignment
                on assignment.id = access_token.training_assignment_id
              where access_token.token = ${props.accessToken}
                and access_token.revoked_at is null
                and access_token.expires_at > now()
                and ${openTrainingAssignmentWhereSql(sql`assignment`)}
              limit 1
            )`
            : sql`null`,
        );
        s.defScalar(
          "employee_language",
          sql`(
            select ${personLanguageSql(block.opts, sql`e`)}
            from db.${sql.ref(personTable(block.opts))} e
            where e.id = ui.person_id
          )`,
        );
        // One row per assignment still needing employee action. Course
        // assignments remain open after the last task when a final course
        // signature is required.
        s.defTable(
          "open_assignments",
          sql`with open_assignment_base as (
                select a.id,
                       a.training_course_id is not null as is_course,
                       coalesce(course.name, d.title, 'Training assignment')
                         as title,
                       case
                         when course.id is null then 'Document'
                         when exists (
                           select 1
                           from db.training_course_section_items course_item
                           join db.training_course_sections course_section
                             on course_section.id = course_item.training_course_section_id
                           where course_section.training_course_version_id =
                               course.current_training_course_version_id
                             and course_item.type = 'other_checklist'
                         ) then 'Program'
                         else 'Course'
                       end as kind,
                       coalesce(
                         (select min(t.due_date)
                          from db.training_employee_tasks t
                          where t.training_assignment_id = a.id
                            and t.status in ('assigned', 'in_progress')),
                         a.due_date
                       ) as due_date,
                       (select count(*)
                        from db.training_employee_tasks t
                        where t.training_assignment_id = a.id
                          and t.status != 'waived') as total_tasks,
                       (select count(*)
                        from db.training_employee_tasks t
                        where t.training_assignment_id = a.id
                          and t.status = 'completed') as done_tasks,
                       exists (
                         select 1
                         from db.training_employee_tasks t
                         where t.training_assignment_id = a.id
                           and t.status in ('in_progress', 'completed')
                       ) as started,
                       (select min(t.id)
                        from db.training_employee_tasks t
                        where t.training_assignment_id = a.id
                          and t.status in ('assigned', 'in_progress'))
                         as document_task_id,
                       exists (
                         select 1
                         from db.training_employee_tasks t
                         join db.training_content_versions v
                           on v.id = t.document_version_id
                         join db.training_content_language_variants variant
                           on variant.id = v.document_language_variant_id
                         join db.training_content_languages lang
                           on lang.code = variant.language
                         where t.training_assignment_id = a.id
                           and t.status in ('assigned', 'in_progress')
                           and lang.code != ui.employee_language
                       ) as uses_default_language,
                       course.requires_final_signature
                         and a.employee_final_signed_at is null
                         and exists (
                           select 1
                           from db.training_employee_tasks t
                           where t.training_assignment_id = a.id
                             and t.status != 'waived'
                         )
                         and not exists (
                           select 1
                           from db.training_employee_tasks t
                           where t.training_assignment_id = a.id
                             and t.status in ('assigned', 'in_progress')
                         ) as needs_final_signature
                from db.training_assignments a
                left join db.training_courses course
                  on course.id = a.training_course_id
                left join db.training_content_documents d
                  on d.id = a.document_id
                where a.person_id = ui.person_id
                  and (
                    exists (
                      select 1
                      from db.training_employee_tasks t
                      where t.training_assignment_id = a.id
                        and t.status in ('assigned', 'in_progress')
                    )
                    or (
                      a.status = 'in_progress'
                      and course.requires_final_signature
                      and a.employee_final_signed_at is null
                      and exists (
                        select 1
                        from db.training_employee_tasks t
                        where t.training_assignment_id = a.id
                          and t.status != 'waived'
                      )
                      and not exists (
                        select 1
                        from db.training_employee_tasks t
                        where t.training_assignment_id = a.id
                          and t.status in ('assigned', 'in_progress')
                      )
                    )
                  )
                  ${
            props.accessToken ? sql`and a.id = ui.access_assignment_id` : sql``
          }
              )
              select *,
                     due_date is not null and due_date < current_date()
                       as is_overdue,
                     due_date is not null
                       and due_date >= current_date()
                       and due_date <= date.add(day, 7, current_date())
                       as is_due_soon
              from open_assignment_base
              order by case
                         when due_date is not null
                           and due_date < current_date() then 0
                         else 1
                       end,
                       due_date nulls last, id desc`,
        );
        s.defTable(
          "notifications",
          sql`select notification.id, notification.title, notification.body,
              notification.created_at, notification.read_at is null as is_unread
            from db.user_notifications notification
            join db.training_assignments assignment
              on assignment.id = try_cast(notification.record_key as bigint)
              and assignment.person_id = ui.person_id
            where notification.recipient_user_id = ${
            props.accessToken
              ? sql`(select ${block.opts.workforce.personSysUserId(sql`person`)}
                  from db.${
                sql.ref(personTable(block.opts))
              } person where person.id = ui.person_id)`
              : sql`current_user`
          }
              and notification.source = ${
            sql.lit(block.opts.notifications.config.key)
          }
              and (notification.snoozed_until is null or notification.snoozed_until <= now())
              ${
            props.accessToken
              ? sql`and notification.record_key = ui.access_assignment_id::string`
              : sql``
          }
            order by notification.created_at desc, notification.id desc
            limit 5`,
        );
        s.defTable(
          "history",
          sql`select a.id,
                     a.status,
                     a.training_course_id is not null as is_course,
                     (
                       select min(t.id)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                     ) as document_task_id,
                     coalesce(course.name, document.title, 'Training assignment')
                       as title,
                     coalesce(
                       (
                         select max(course_version.version_label)
                         from db.training_employee_tasks t
                         join db.training_course_section_items course_item
                           on course_item.id = t.training_course_section_item_id
                         join db.training_course_sections course_section
                           on course_section.id = course_item.training_course_section_id
                         left join db.training_course_versions course_version
                           on course_version.id =
                             course_section.training_course_version_id
                         where t.training_assignment_id = a.id
                       ),
                       'Current course version'
                     ) as version_label,
                     lang.code as language,
                     (
                       select max(t.completed_at)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                         and t.status = 'completed'
                     ) as completed_at,
                     (
                       select count(*)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                         and t.status != 'waived'
                     ) as total_tasks,
                     (
                       select count(*)
                       from db.training_assignment_validations av
                       where av.training_assignment_id = a.id
                     ) as validation_count,
                     (
                       case when a.final_primary_validator_id is not null then 1 else 0 end
                       + case when a.final_secondary_validator_id is not null then 1 else 0 end
                     ) as required_assignment_validation_count
              from db.training_assignments a
              left join db.training_courses course
                on course.id = a.training_course_id
              left join db.training_content_documents document
                on document.id = a.document_id
              left join db.training_content_languages lang
                on lang.code = a.training_language
              where a.person_id = ui.person_id
                and a.status in ('completed', 'validation_pending')
                and not exists (
                  select 1
                  from db.training_employee_tasks open_task
                  where open_task.training_assignment_id = a.id
                    and open_task.status in ('assigned', 'in_progress')
                )
                ${
            props.accessToken ? sql`and a.id = ui.access_assignment_id` : sql``
          }
              order by completed_at desc nulls last, a.id desc
              limit 25`,
        );
      }}
    >
      <Show
        when={props.accessToken ? sql`person_id is not null` : sql`true`}
        fallback={<AccessProblemNotice block={props.block} kind="invite" />}
      >
        <PageShell
          title={employeeText(sql`employee_language`, {
            en: "My Training",
            es: "Mi Capacitación",
          })}
          subtitle={employeeText(sql`employee_language`, {
            en:
              "Assigned policies, training checklists, and signed completions.",
            es:
              "Políticas asignadas, listas de capacitación y finalizaciones firmadas.",
          })}
        >
          {(props.showPortalNav ?? true) && (
            <EmployeePortalNav
              block={props.block}
              active="training"
              accessToken={props.accessToken}
              employeeLanguage={sql`employee_language`}
            />
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card variant="outlined" className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-2 w-full">
                  <Typography level="title-lg">
                    {employeeText(sql`employee_language`, {
                      en: "Due Training",
                      es: "Capacitación pendiente",
                    })}
                  </Typography>
                  <Show when={sql`exists (select 1 from open_assignments)`}>
                    <Chip size="sm" variant="soft" color="neutral">
                      {sql`(select count(*) from open_assignments)::string`}
                    </Chip>
                  </Show>
                </div>
              </CardHeader>
              <CardContent>
                <Show when={sql`not exists (select 1 from open_assignments)`}>
                  <EmptyState
                    icon="Celebration"
                    title={employeeText(sql`employee_language`, {
                      en: "You're all caught up",
                      es: "Está al día",
                    })}
                    body={employeeText(sql`employee_language`, {
                      en:
                        "No training is due right now. New assignments will appear here.",
                      es:
                        "No hay capacitación pendiente por ahora. Las nuevas asignaciones aparecerán aquí.",
                    })}
                  />
                </Show>
                <div className="flex flex-col gap-2">
                  <Show
                    when={sql`exists (
                    select 1 from open_assignments where is_overdue
                  )`}
                  >
                    <TaskGroupHeader
                      dotClass="bg-danger-500"
                      label={employeeText(sql`employee_language`, {
                        en: "Overdue",
                        es: "Atrasadas",
                      })}
                      count={sql`(select count(*) from open_assignments
                      where is_overdue)`}
                    />
                  </Show>
                  <Each
                    table="open_assignments"
                    recordName="assignment"
                    where={sql`assignment.is_overdue`}
                  >
                    <EmployeeAssignmentCard
                      block={props.block}
                      accessToken={props.accessToken}
                    />
                  </Each>
                  <Show
                    when={sql`exists (
                    select 1 from open_assignments where is_due_soon
                  )`}
                  >
                    <TaskGroupHeader
                      dotClass="bg-amber-500"
                      label={employeeText(sql`employee_language`, {
                        en: "Due soon",
                        es: "Vencen pronto",
                      })}
                      count={sql`(select count(*) from open_assignments
                      where is_due_soon)`}
                    />
                  </Show>
                  <Each
                    table="open_assignments"
                    recordName="assignment"
                    where={sql`assignment.is_due_soon`}
                  >
                    <EmployeeAssignmentCard
                      block={props.block}
                      accessToken={props.accessToken}
                    />
                  </Each>
                  <Show
                    when={sql`exists (
                    select 1 from open_assignments
                    where not is_overdue and not is_due_soon
                  ) and exists (
                    select 1 from open_assignments
                    where is_overdue or is_due_soon
                  )`}
                  >
                    <TaskGroupHeader
                      dotClass="bg-neutral-400"
                      label={employeeText(sql`employee_language`, {
                        en: "Upcoming",
                        es: "Próximas",
                      })}
                      count={sql`(select count(*) from open_assignments
                      where not is_overdue and not is_due_soon)`}
                    />
                  </Show>
                  <Each
                    table="open_assignments"
                    recordName="assignment"
                    where={sql`not assignment.is_overdue and not assignment.is_due_soon`}
                  >
                    <EmployeeAssignmentCard
                      block={props.block}
                      accessToken={props.accessToken}
                    />
                  </Each>
                </div>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardHeader>
                <Typography level="title-lg" startIcon="Notifications">
                  {employeeText(sql`employee_language`, {
                    en: "Notifications",
                    es: "Notificaciones",
                  })}
                </Typography>
              </CardHeader>
              <CardContent>
                <Show when={sql`not exists (select 1 from notifications)`}>
                  <EmptyState
                    icon="Notifications"
                    title={employeeText(sql`employee_language`, {
                      en: "No notifications",
                      es: "No hay notificaciones",
                    })}
                    body={employeeText(sql`employee_language`, {
                      en: includeCompliance
                        ? "New training assignments and retraining notices will appear here."
                        : "New training assignments and notices will appear here.",
                      es: includeCompliance
                        ? "Las nuevas asignaciones y avisos de recapacitación aparecerán aquí."
                        : "Las nuevas asignaciones y notificaciones de capacitación aparecerán aquí.",
                    })}
                  />
                </Show>
                <div className="grid gap-2">
                  <Each table="notifications" recordName="notification">
                    <a
                      href={props.accessToken
                        ? undefined
                        : sql`'/notifications/open/' || cast(notification.id as string)`}
                      className="block p-3 border border-divider rounded-md bg-white hover:border-primary-300"
                    >
                      <div className="flex items-start gap-2">
                        <Show when={sql`notification.is_unread`}>
                          <span
                            role="img"
                            aria-label={employeeText(sql`employee_language`, {
                              en: "Unread",
                              es: "Sin leer",
                            })}
                            className="mt-2 size-2 rounded-full bg-primary-500 shrink-0"
                          />
                        </Show>
                        <div className="min-w-0">
                          <Typography level="title-sm">
                            {sql`notification.title`}
                          </Typography>
                          <Show when={sql`notification.body is not null`}>
                            <Typography level="body-sm">
                              {sql`notification.body`}
                            </Typography>
                          </Show>
                        </div>
                      </div>
                      <Typography level="body-sm">
                        {formatDateTimeSql(sql`notification.created_at`)}
                      </Typography>
                    </a>
                  </Each>
                </div>
                {!props.accessToken && (
                  <Show when={sql`exists (select 1 from notifications)`}>
                    <Button
                      component="a"
                      href="/notifications"
                      variant="plain"
                      className="mt-2"
                      endIcon="ArrowForward"
                    >
                      {employeeText(sql`employee_language`, {
                        en: "View all notifications",
                        es: "Ver todas las notificaciones",
                      })}
                    </Button>
                  </Show>
                )}
              </CardContent>
            </Card>
          </div>
          <Card variant="outlined">
            <CardHeader>
              <div className="flex items-center gap-2 w-full">
                <Typography level="title-lg" startIcon="Verified">
                  {employeeText(sql`employee_language`, {
                    en: "My Completed Training",
                    es: "Mi Capacitación Completada",
                  })}
                </Typography>
                <Show when={sql`exists (select 1 from history)`}>
                  <Chip size="sm" variant="soft" color="success">
                    {sql`(select count(*) from history)::string`}
                  </Chip>
                </Show>
              </div>
            </CardHeader>
            <CardContent>
              <Show when={sql`not exists (select 1 from history)`}>
                <EmptyState
                  icon="History"
                  title={employeeText(sql`employee_language`, {
                    en: "Nothing signed yet",
                    es: "Aún no hay firmas",
                  })}
                  body={employeeText(sql`employee_language`, {
                    en:
                      "Training you sign appears here as your personal record, including the exact revision you signed.",
                    es:
                      "La capacitación que firme aparecerá aquí como su registro personal, incluida la revisión exacta que firmó.",
                  })}
                />
              </Show>
              <div className="grid gap-2">
                <Each table="history" recordName="completed">
                  <a
                    href={sql`case when completed.is_course then ${
                      employeeCourseHref(
                        props.block,
                        sql`completed.id`,
                        props.accessToken,
                      )
                    } else ${
                      employeeTaskHref(
                        props.block,
                        sql`completed.document_task_id`,
                        props.accessToken,
                      )
                    } end || '?training_return_source=dashboard'`}
                    className="p-3 border border-divider rounded-md bg-white hover:bg-neutral-50 hover:border-neutral-300 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <Typography level="title-sm">
                        {sql`completed.title`}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {sql`completed.version_label ||
                        coalesce(' · ' || upper(completed.language), '') ||
                        ' · ' || ${
                          employeeText(sql`employee_language`, {
                            en: "Completed",
                            es: "Completado",
                          })
                        } || ' ' || ${
                          formatDateSql(sql`completed.completed_at`)
                        } || ' · ' || completed.total_tasks::string ||
                        case when completed.total_tasks = 1 then ' task' else ' tasks' end`}
                      </Typography>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Show
                        when={sql`completed.required_assignment_validation_count > 0`}
                      >
                        <StatusChip
                          fallbackLabel={sql`completed.status`}
                          cases={[
                            {
                              when: sql`completed.status = 'completed'
                                  and completed.validation_count >= completed.required_assignment_validation_count`,
                              label: employeeText(sql`employee_language`, {
                                en: "Validated",
                                es: "Validada",
                              }),
                              color: "success",
                            },
                            {
                              when: sql`completed.status = 'validation_pending'
                                  or completed.validation_count < completed.required_assignment_validation_count`,
                              label: employeeText(sql`employee_language`, {
                                en: "Awaiting validation",
                                es: "Esperando validación del gerente",
                              }),
                              color: "warning",
                            },
                          ]}
                        />
                      </Show>
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-700">
                        {employeeText(sql`employee_language`, {
                          en: "View record",
                          es: "Ver registro",
                        })}
                        <MaterialIcon
                          icon="ArrowForward"
                          className="text-base"
                        />
                      </span>
                    </div>
                  </a>
                </Each>
              </div>
            </CardContent>
          </Card>
        </PageShell>
      </Show>
    </Data>
  );
}

export function EmployeeTrainingCoursePage(
  props: {
    block: TrainingBlock;
    accessToken?: Sql;
    personId?: Sql;
    backHref?: Sql;
    backLabel?: string;
    validationMode?: boolean;
  },
) {
  const block = props.block;
  const validationLabels = trainingValidationLabels(block.opts);
  const secondaryByPermission = secondaryValidatorSignoffByPermission(
    block.opts,
  );
  const validationEnabled = true;
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("course_step_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("signature_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("course_task_signature_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("validation_error", {
          type: { type: "String", maxLength: 1000 },
        });
        s.defScalar("final_primary_validator_id", { type: "BigInt" });
        s.defScalar("final_secondary_validator_id", { type: "BigInt" });
      }}
    >
      <Data
        procedure={(s) => {
          s.defScalar(
            "person_id",
            props.personId ? props.personId : props.accessToken
              ? sql`(
              select assignment.person_id
              from db.training_access_tokens access_token
              join db.training_assignments assignment
                on assignment.id = access_token.training_assignment_id
              where access_token.token = ${props.accessToken}
                and access_token.revoked_at is null
                and access_token.expires_at > now()
                and training_assignment_id = ui.training_assignment_id
                and ${openTrainingAssignmentWhereSql(sql`assignment`)}
              limit 1
            )`
              : currentEmployeeId(block.opts),
          );
          s.defRecord(
            "course_assignment",
            sql`select a.id, course.name as title,
                     a.final_primary_validator_id,
                     a.final_secondary_validator_id,
                     a.employee_final_signature_data,
                     a.employee_final_signed_at,
                     course.requires_final_signature,
                     course.generates_certification,
                     exists (
                       select 1
                       from db.training_assignment_validations av
                          where av.training_assignment_id = a.id
                         and av.validation_stage_code = ${
              sql.lit(validationLabels.primaryStageCode)
            }
                     ) as primary_validator_validated,
                     exists (
                       select 1
                       from db.training_assignment_validations av
                          where av.training_assignment_id = a.id
                         and av.validation_stage_code = ${
              sql.lit(validationLabels.secondaryStageCode)
            }
                     ) as secondary_validator_validated,
                     coalesce(
                       ${currentEmployeeId(block.opts)}
                         = a.final_primary_validator_id,
                       false
                     ) as current_user_is_primary_validator,
                     ${
              secondaryByPermission
                ? currentUserHasPermission(
                  sql.lit(validationLabels.secondaryStagePermission),
                )
                : sql`coalesce(
                       ${currentEmployeeId(block.opts)}
                         = a.final_secondary_validator_id,
                       false
                     )`
            } as current_user_is_secondary_validator,
                     ${
              employeeName(block.opts, sql`final_primary_validator`)
            } as final_primary_validator_name,
                     ${
              employeeName(block.opts, sql`final_secondary_validator`)
            } as final_secondary_validator_name,
                     (
                       select ${employeeName(block.opts, sql`current_person`)}
                       from db.${
              sql.ref(personTable(block.opts))
            } current_person
                       where current_person.id = ${
              currentEmployeeId(block.opts)
            }
                     ) as current_user_name,
                     ${
              personLanguageSql(block.opts, sql`e`)
            } as employee_language,
                     ${employeeName(block.opts, sql`e`)} as employee_name,
                     (select min(t.due_date)
                      from db.training_employee_tasks t
                      where t.training_assignment_id = a.id
                        and t.status in ('assigned', 'in_progress'))
                       as due_date,
                     (select count(*)
                      from db.training_employee_tasks t
                      where t.training_assignment_id = a.id
                        and t.status != 'waived') as total_tasks,
                     (select count(*)
                      from db.training_employee_tasks t
                      where t.training_assignment_id = a.id
                        and t.status = 'completed') as done_tasks,
                     a.status
              from db.training_assignments a
              join db.${
              sql.ref(personTable(block.opts))
            } e on e.id = a.person_id
              join db.training_courses course
                on course.id = a.training_course_id
              left join db.${
              sql.ref(personTable(block.opts))
            } final_primary_validator
                on final_primary_validator.id = a.final_primary_validator_id
              left join db.${
              sql.ref(personTable(block.opts))
            } final_secondary_validator
                on final_secondary_validator.id =
                  a.final_secondary_validator_id
              where a.id = ui.training_assignment_id
                and a.person_id = ui.person_id`,
          );
          s.defTable(
            "course_tasks",
            sql`select t.id, t.id as task_id, t.status,
                     section.id as section_id,
                     section.name as section_name,
                     section.description as section_description,
                     section.ordinal as section_ordinal,
                     i.sort_order as item_ordinal,
                     coalesce(i.external_title, i.content) as title,
                     case
                       when i.type = 'external_link' then 'External link'
                       when i.type = 'essay' then 'Essay'
                       when i.type = 'other_checklist' then 'Checklist'
                       when i.type = 'signature' then 'Signature'
                       when i.type = 'assessment' then 'Assessment'
                       else 'Practical'
                     end as kind,
                     i.type as item_type,
                     (select task_state.derived_state
                      from db.training_task_derived_state task_state
                      where task_state.task_id = t.id)
                       as assessment_state,
                     coalesce(i.requires_essay, false)
                       or i.type = 'essay' as requires_essay,
                     i.essay_prompt,
                     t.essay_response,
                     t.signature_name,
                     t.signature_data,
                     i.external_url
              from db.training_employee_tasks t
              left join db.training_course_section_items i
                on i.id = t.training_course_section_item_id
              left join db.training_course_sections section
                on section.id = i.training_course_section_id
              where t.training_assignment_id = ui.training_assignment_id
                and t.status != 'waived'
              order by section.ordinal nulls last, i.sort_order, t.id`,
          );
          // Library documents attached to each step, pinned to the exact
          // version snapshotted on the task so signed steps stay tied to
          // the revision the employee saw.
          s.defTable(
            "course_task_item_documents",
            sql`select task_doc.id,
                    task_doc.training_employee_task_id,
                    coalesce(item_doc.label, d.title) as title,
                    v.id as document_version_id,
                    v.file_name, v.content_mode, v.blob_hash,
                    v.rich_content, v.external_url
                from db.training_task_item_documents task_doc
                join db.training_employee_tasks t
                  on t.id = task_doc.training_employee_task_id
                join db.training_course_section_item_documents item_doc
                  on item_doc.id =
                    task_doc.training_course_section_item_document_id
                join db.training_content_documents d
                  on d.id = item_doc.document_id
                join db.training_content_versions v
                  on v.id = task_doc.document_version_id
                where t.training_assignment_id = ui.training_assignment_id
                order by t.id, item_doc.sort_order, task_doc.id`,
          );
          s.defTable(
            "primary_validator_options",
            sql`select p.id, ${employeeName(block.opts, sql`p`)} as name
                from db.${sql.ref(personTable(block.opts))} p
                where ${
              userHasPermission(
                sql.lit(validationLabels.primaryStagePermission),
                block.opts.workforce.personSysUserId(sql`p`),
              )
            }
                order by name`,
          );
          s.defTable(
            "secondary_validator_options",
            sql`select p.id, ${employeeName(block.opts, sql`p`)} as name
                from db.${sql.ref(personTable(block.opts))} p
                where ${
              userHasPermission(
                sql.lit(validationLabels.secondaryStagePermission),
                block.opts.workforce.personSysUserId(sql`p`),
              )
            }
                order by name`,
          );
          s.defTable(
            "assignment_validations",
            sql`select av.*, ${employeeName(block.opts, sql`validator`)}
                       as validator_name
                from db.training_assignment_validations av
                left join db.${sql.ref(personTable(block.opts))} validator
                  on validator.id = av.validated_by_id
                where av.training_assignment_id = ui.training_assignment_id
                order by av.validated_at, av.id`,
          );
        }}
      >
        <Show
          when={sql`course_assignment.id is not null`}
          fallback={
            <AccessProblemNotice
              block={props.block}
              kind={props.accessToken ? "invite" : "task"}
            />
          }
        >
          <PageShell
            title={sql`course_assignment.title`}
            subtitle={sql`coalesce(${
              relativeDueSql(
                sql`course_assignment.employee_language`,
                sql`course_assignment.due_date`,
              )
            }, '')`}
          >
            <div className="max-w-4xl mx-auto">
              <div className="mb-3">
                <Button
                  component="a"
                  href={props.backHref ??
                    employeeHomeHref(props.block, props.accessToken)}
                  variant="plain"
                  color="neutral"
                  size="sm"
                  startIcon="ArrowBack"
                >
                  {props.backLabel ??
                    employeeText(sql`course_assignment.employee_language`, {
                      en: "Back to My Training",
                      es: "Volver a Mi Capacitación",
                    })}
                </Button>
              </div>
              <Card variant="outlined">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 w-full">
                    <div>
                      <Typography level="title-lg" startIcon="Checklist">
                        {employeeText(
                          sql`course_assignment.employee_language`,
                          {
                            en: "Course steps",
                            es: "Pasos del curso",
                          },
                        )}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {employeeText(
                          sql`course_assignment.employee_language`,
                          {
                            en:
                              "Open the documents, write any required responses, and check each step off.",
                            es:
                              "Abra los documentos, escriba las respuestas requeridas y marque cada paso.",
                          },
                        )}
                      </Typography>
                    </div>
                    <Typography
                      level="body-sm"
                      className="text-neutral-600 shrink-0"
                    >
                      {sql`course_assignment.done_tasks::string || '/' || course_assignment.total_tasks::string`}
                      {" "}
                      {employeeText(sql`course_assignment.employee_language`, {
                        en: "steps done",
                        es: "pasos completados",
                      })}
                    </Typography>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-1.5 w-full rounded-full bg-neutral-200 overflow-hidden mb-4">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all"
                      style={{
                        width:
                          sql`(course_assignment.done_tasks * 100 / greatest(course_assignment.total_tasks, 1))::string || '%'`,
                      }}
                    />
                  </div>
                  <Show
                    when={sql`course_assignment.done_tasks = course_assignment.total_tasks
                      and ${
                      props.validationMode
                        ? sql`course_assignment.employee_final_signed_at is not null`
                        : sql`true`
                    }`}
                  >
                    <Alert
                      color="success"
                      startIcon="CheckCircle"
                      className="mb-4"
                    >
                      {employeeText(sql`course_assignment.employee_language`, {
                        en: "All steps of this course are complete.",
                        es: "Todos los pasos de este curso están completos.",
                      })}
                    </Alert>
                  </Show>
                  <Show when={sql`course_step_error is not null`}>
                    <Alert color="danger" startIcon="Error" className="mb-4">
                      {sql`course_step_error`}
                    </Alert>
                  </Show>
                  <div className="flex flex-col gap-3">
                    <Each table="course_tasks" recordName="course_task">
                      <Show
                        when={sql`course_task.section_id is not null
                          and not exists (
                            select 1
                            from course_tasks previous
                            where previous.section_id = course_task.section_id
                              and (
                                previous.section_ordinal < course_task.section_ordinal
                                or (
                                  previous.section_ordinal = course_task.section_ordinal
                                  and (
                                    previous.item_ordinal < course_task.item_ordinal
                                    or (
                                      previous.item_ordinal = course_task.item_ordinal
                                      and previous.id < course_task.id
                                    )
                                  )
                                )
                              )
                          )`}
                      >
                        <div className="mt-2 first:mt-0 border-b border-divider pb-2">
                          <Typography level="title-md">
                            {sql`course_task.section_name`}
                          </Typography>
                          <Show
                            when={sql`nullif(trim(coalesce(course_task.section_description, '')), '') is not null`}
                          >
                            <Typography
                              level="body-sm"
                              className="text-neutral-600 mt-1"
                            >
                              {sql`course_task.section_description`}
                            </Typography>
                          </Show>
                        </div>
                      </Show>
                      <div className="p-4 border border-divider rounded-md bg-white">
                        <div className="flex items-start gap-3">
                          <div className="pt-0.5 shrink-0">
                            <Show
                              when={sql`course_task.item_type = 'signature'`}
                            >
                              <Show
                                when={sql`course_task.status = 'completed'`}
                                fallback={
                                  <MaterialIcon
                                    icon="Draw"
                                    className="text-neutral-500"
                                  />
                                }
                              >
                                <MaterialIcon
                                  icon="CheckCircle"
                                  className="text-emerald-600"
                                />
                              </Show>
                            </Show>
                            <Show
                              when={sql`course_task.item_type = 'assessment'`}
                            >
                              <Show
                                when={sql`course_task.assessment_state = 'passed'`}
                                fallback={
                                  <MaterialIcon
                                    icon="Quiz"
                                    className="text-neutral-500"
                                  />
                                }
                              >
                                <MaterialIcon
                                  icon="CheckCircle"
                                  className="text-emerald-600"
                                />
                              </Show>
                            </Show>
                            <Show
                              when={sql`course_task.item_type != 'signature'
                                and course_task.item_type != 'assessment'`}
                            >
                              <Checkbox
                                checked={sql`course_task.status = 'completed'`}
                                disabled={props.validationMode
                                  ? sql`true`
                                  : sql`course_assignment.status = 'completed'
                                    or course_assignment.employee_final_signed_at is not null`}
                                label=""
                                onCheckboxChange={(s) => {
                                  s.setScalar(
                                    "course_step_error",
                                    sql`null`,
                                  );
                                  s.tryServer({
                                    body: (s) => {
                                      s.if(
                                        sql`target_checked`,
                                        (s) => {
                                          s.if(
                                            sql`course_task.requires_essay
                                              and nullif(trim(coalesce(course_task.essay_response, '')), '') is null`,
                                            (s) => {
                                              s.setScalar(
                                                "ui.course_step_error",
                                                employeeText(
                                                  sql`course_assignment.employee_language`,
                                                  {
                                                    en:
                                                      "Write the required response before checking this step off.",
                                                    es:
                                                      "Escriba la respuesta requerida antes de marcar este paso.",
                                                  },
                                                ),
                                              );
                                              // Re-render so the checkbox
                                              // snaps back to unchecked.
                                              s.refetch();
                                              s.return();
                                            },
                                          );
                                          s.startTransaction();
                                          s.callStoredProcedure(
                                            "training_complete_task",
                                            {
                                              inputScalars: {
                                                p_task_id:
                                                  sql`course_task.task_id`,
                                                p_access_token:
                                                  props.accessToken ??
                                                    sql`null`,
                                                p_signature_data: sql`null`,
                                                p_completion_attestation:
                                                  sql`null`,
                                                p_essay_response: sql`null`,
                                              },
                                            },
                                          );
                                          s.commitTransaction();
                                          s.setScalar(
                                            "ui.course_step_error",
                                            sql`null`,
                                          );
                                        },
                                        (s) => {
                                          s.startTransaction();
                                          s.modify(sql`
                                            update db.training_employee_tasks
                                            set status = 'in_progress',
                                                completed_at = null,
                                                training_language = null
                                            where id = course_task.task_id
                                              and exists (
                                                select 1
                                                from db.training_assignments task_assignment
                                                where task_assignment.id = training_assignment_id
                                                  and task_assignment.person_id = ui.person_id
                                                  and task_assignment.status != 'completed'
                                                  and task_assignment.employee_final_signed_at is null
                                              )
                                              and status = 'completed'
                                          `);
                                          s.modify(sql`
                                            update db.training_assignments
                                            set status = 'in_progress'
                                            where id = ui.training_assignment_id
                                              and exists (
                                                select 1
                                                from db.training_employee_tasks t
                                                where t.training_assignment_id = ui.training_assignment_id
                                                  and t.status in ('assigned', 'in_progress')
                                              )
                                          `);
                                          s.commitTransaction();
                                        },
                                      );
                                      s.refetch();
                                    },
                                    catch: (s) => {
                                      s.setScalar(
                                        "course_step_error",
                                        employeeText(
                                          sql`course_assignment.employee_language`,
                                          {
                                            en:
                                              "The step could not be updated.",
                                            es:
                                              "No se pudo actualizar el paso.",
                                          },
                                        ),
                                      );
                                    },
                                  });
                                }}
                              />
                            </Show>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Typography level="title-md">
                                {sql`course_task.title`}
                              </Typography>
                              <Chip size="sm" variant="soft" color="neutral">
                                {sql`course_task.kind`}
                              </Chip>
                              <Show
                                when={sql`course_task.item_type = 'assessment'`}
                              >
                                <StatusChip
                                  fallbackLabel={sql`course_task.assessment_state`}
                                  cases={[
                                    {
                                      when:
                                        sql`course_task.assessment_state = 'not_started'`,
                                      label: employeeText(
                                        sql`course_assignment.employee_language`,
                                        {
                                          en: "Not started",
                                          es: "Sin iniciar",
                                        },
                                      ),
                                      color: "neutral",
                                    },
                                    {
                                      when:
                                        sql`course_task.assessment_state = 'in_progress'`,
                                      label: employeeText(
                                        sql`course_assignment.employee_language`,
                                        {
                                          en: "In progress",
                                          es: "En progreso",
                                        },
                                      ),
                                      color: "primary",
                                    },
                                    {
                                      when:
                                        sql`course_task.assessment_state = 'review_pending'`,
                                      label: employeeText(
                                        sql`course_assignment.employee_language`,
                                        {
                                          en: "Review pending",
                                          es: "Revisión pendiente",
                                        },
                                      ),
                                      color: "warning",
                                    },
                                    {
                                      when:
                                        sql`course_task.assessment_state = 'passed'`,
                                      label: employeeText(
                                        sql`course_assignment.employee_language`,
                                        { en: "Passed", es: "Aprobada" },
                                      ),
                                      color: "success",
                                    },
                                    {
                                      when:
                                        sql`course_task.assessment_state in ('failed_retake_available', 'failed_final')`,
                                      label: employeeText(
                                        sql`course_assignment.employee_language`,
                                        { en: "Failed", es: "Reprobada" },
                                      ),
                                      color: "danger",
                                    },
                                  ]}
                                />
                              </Show>
                            </div>
                            <Show
                              when={sql`course_task.item_type = 'assessment'`}
                            >
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  component="a"
                                  href={employeeAssessmentHref(
                                    props.block,
                                    sql`course_task.task_id`,
                                    props.accessToken,
                                  )}
                                  variant="outlined"
                                  color="neutral"
                                  size="sm"
                                  startIcon="Quiz"
                                >
                                  {employeeText(
                                    sql`course_assignment.employee_language`,
                                    {
                                      en: "Open assessment",
                                      es: "Abrir evaluación",
                                    },
                                  )}
                                </Button>
                              </div>
                            </Show>
                            <Show
                              when={sql`course_task.external_url is not null`}
                            >
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  component="a"
                                  href={sql`course_task.external_url`}
                                  target="_blank"
                                  variant="outlined"
                                  color="neutral"
                                  size="sm"
                                  startIcon="OpenInNew"
                                >
                                  {employeeText(
                                    sql`course_assignment.employee_language`,
                                    { en: "Open link", es: "Abrir enlace" },
                                  )}
                                </Button>
                              </div>
                            </Show>
                            <Show
                              when={sql`exists (
                              select 1
                              from course_task_item_documents doc
                              where doc.training_employee_task_id = course_task.task_id
                            )`}
                            >
                              <div className="mt-2 flex flex-col gap-2">
                                <Each
                                  table="course_task_item_documents"
                                  recordName="step_doc"
                                  where={sql`step_doc.training_employee_task_id = course_task.task_id`}
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-divider bg-neutral-50 px-3 py-2">
                                    <Typography
                                      level="title-sm"
                                      className="min-w-0"
                                    >
                                      {sql`step_doc.title`}
                                    </Typography>
                                    <div className="flex gap-2">
                                      <Show
                                        when={sql`step_doc.external_url is not null`}
                                      >
                                        <Button
                                          component="a"
                                          href={trainingExternalVersionUrl(
                                            sql`step_doc.document_version_id`,
                                            sql`course_task.task_id`,
                                            props.accessToken,
                                          )}
                                          target="_blank"
                                          variant="outlined"
                                          color="neutral"
                                          size="sm"
                                          startIcon="OpenInNew"
                                        >
                                          {employeeText(
                                            sql`course_assignment.employee_language`,
                                            { en: "Open", es: "Abrir" },
                                          )}
                                        </Button>
                                      </Show>
                                      <Show
                                        when={sql`step_doc.blob_hash is not null`}
                                      >
                                        <Button
                                          component="a"
                                          href={trainingFileVersionUrl(
                                            sql`step_doc.document_version_id`,
                                            sql`course_task.task_id`,
                                            props.accessToken,
                                          )}
                                          target="_blank"
                                          variant="outlined"
                                          color="neutral"
                                          size="sm"
                                          startIcon="OpenInNew"
                                        >
                                          {employeeText(
                                            sql`course_assignment.employee_language`,
                                            { en: "Open", es: "Abrir" },
                                          )}
                                        </Button>
                                      </Show>
                                    </div>
                                  </div>
                                  <Show
                                    when={sql`step_doc.rich_content is not null`}
                                  >
                                    <div className="rounded-md border border-divider bg-white p-3">
                                      <LexicalRichTextDisplay
                                        value={sql`step_doc.rich_content`}
                                        imageSrcPrefixRewrite={trainingNativeImageSrcPrefixRewrite(
                                          sql`step_doc.document_version_id`,
                                          sql`course_task.task_id`,
                                          props.accessToken,
                                        )}
                                      />
                                    </div>
                                  </Show>
                                </Each>
                              </div>
                            </Show>
                            <Show when={sql`course_task.requires_essay`}>
                              <FormControl className="mt-3">
                                <FormLabel>
                                  {sql`coalesce(course_task.essay_prompt, ${
                                    employeeText(
                                      sql`course_assignment.employee_language`,
                                      {
                                        en:
                                          "Describe what you learned and how you will apply it.",
                                        es:
                                          "Describa lo que aprendió y cómo lo aplicará.",
                                      },
                                    )
                                  })`}
                                </FormLabel>
                                <Show
                                  when={sql`course_task.status != 'completed'
                                    and ${
                                    props.validationMode
                                      ? sql`false`
                                      : sql`true`
                                  }`}
                                  fallback={
                                    <Typography
                                      level="body-sm"
                                      className="text-neutral-700"
                                    >
                                      {sql`course_task.essay_response`}
                                    </Typography>
                                  }
                                >
                                  <Textarea
                                    value={sql`coalesce(course_task.essay_response, '')`}
                                    minRows={3}
                                    onInput={(s) => {
                                      s.tryServer({
                                        body: (s) => {
                                          s.startTransaction();
                                          s.modify(sql`
                                          update db.training_employee_tasks
                                          set essay_response = nullif(trim(target_value), ''),
                                              status = case
                                                when status = 'assigned' then 'in_progress'
                                                else status
                                              end
                                          where id = course_task.task_id
                                              and exists (
                                                select 1
                                                from db.training_assignments task_assignment
                                                where task_assignment.id = training_assignment_id
                                                  and task_assignment.person_id = ui.person_id
                                                  and task_assignment.status != 'completed'
                                                  and task_assignment.employee_final_signed_at is null
                                              )
                                            and status in ('assigned', 'in_progress')
                                        `);
                                          s.commitTransaction();
                                          s.refetch();
                                        },
                                      });
                                    }}
                                  />
                                </Show>
                              </FormControl>
                            </Show>
                            <Show
                              when={sql`course_task.item_type = 'signature'`}
                            >
                              <div className="mt-3 rounded-md border border-divider bg-neutral-50 p-3">
                                <Show
                                  when={sql`course_task.status = 'completed'`}
                                  fallback={props.validationMode
                                    ? (
                                      <Typography
                                        level="body-sm"
                                        className="text-neutral-600"
                                      >
                                        {employeeText(
                                          sql`course_assignment.employee_language`,
                                          {
                                            en: "Signature pending.",
                                            es: "Firma pendiente.",
                                          },
                                        )}
                                      </Typography>
                                    )
                                    : (
                                      <div className="grid gap-3">
                                        <Show
                                          when={sql`course_task_signature_error is not null`}
                                        >
                                          <Alert
                                            color="danger"
                                            startIcon="Error"
                                          >
                                            {sql`course_task_signature_error`}
                                          </Alert>
                                        </Show>
                                        <SignaturePad
                                          label={employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en: "Draw your signature",
                                              es: "Dibuje su firma",
                                            },
                                          )}
                                          submitLabel={employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en: "Sign step",
                                              es: "Firmar paso",
                                            },
                                          )}
                                          onSigned={(s, signatureData) => {
                                            s.setScalar(
                                              "course_task_signature_error",
                                              sql`null`,
                                            );
                                            s.tryServer({
                                              body: (s) => {
                                                s.startTransaction();
                                                s.callStoredProcedure(
                                                  "training_complete_task",
                                                  {
                                                    inputScalars: {
                                                      p_task_id:
                                                        sql`course_task.task_id`,
                                                      p_access_token:
                                                        props.accessToken ??
                                                          sql`null`,
                                                      p_signature_data:
                                                        signatureData,
                                                      p_completion_attestation:
                                                        sql`null`,
                                                      p_essay_response:
                                                        sql`null`,
                                                    },
                                                  },
                                                );
                                                s.commitTransaction();
                                                s.setScalar(
                                                  "course_task_signature_error",
                                                  sql`null`,
                                                );
                                                s.refetch();
                                              },
                                              catch: (s) => {
                                                s.setScalar(
                                                  "course_task_signature_error",
                                                  employeeText(
                                                    sql`course_assignment.employee_language`,
                                                    {
                                                      en:
                                                        "The signature could not be saved.",
                                                      es:
                                                        "No se pudo guardar la firma.",
                                                    },
                                                  ),
                                                );
                                              },
                                            });
                                          }}
                                        />
                                      </div>
                                    )}
                                >
                                  <div className="grid gap-2">
                                    <Typography
                                      level="body-sm"
                                      className="text-neutral-700"
                                      startIcon="Draw"
                                    >
                                      {sql`course_task.signature_name`}
                                    </Typography>
                                    <Show
                                      when={sql`course_task.signature_data is not null`}
                                    >
                                      <img
                                        src={sql`course_task.signature_data`}
                                        alt="Employee signature"
                                        className="max-h-24 w-fit rounded border border-divider bg-white p-2"
                                      />
                                    </Show>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </Each>
                  </div>
                  <Show
                    when={sql`course_assignment.done_tasks = course_assignment.total_tasks
                      and course_assignment.requires_final_signature`}
                  >
                    <div className="mt-5 rounded-md border border-divider bg-neutral-50 p-4">
                      <Typography level="title-md" startIcon="Draw">
                        {validationEnabled
                          ? sql`case
                              when course_assignment.generates_certification
                              then ${
                            employeeText(
                              sql`course_assignment.employee_language`,
                              {
                                en:
                                  `Choose ${validationLabels.primaryStageDisplayName} and ${validationLabels.secondaryStageDisplayName} and sign`,
                                es: "Elija validadores y firme",
                              },
                            )
                          }
                              else ${
                            employeeText(
                              sql`course_assignment.employee_language`,
                              {
                                en:
                                  `Choose ${validationLabels.primaryStageDisplayName} and sign`,
                                es: "Elija validador y firme",
                              },
                            )
                          }
                            end`
                          : employeeText(
                            sql`course_assignment.employee_language`,
                            {
                              en: "Sign completed course",
                              es: "Firme el curso completado",
                            },
                          )}
                      </Typography>
                      <Typography
                        level="body-sm"
                        className="text-neutral-600 mt-1"
                      >
                        {validationEnabled
                          ? sql`case
                              when course_assignment.generates_certification
                              then ${
                            secondaryByPermission
                              ? employeeText(
                                sql`course_assignment.employee_language`,
                                {
                                  en:
                                    `Choose the ${validationLabels.primaryStageDisplayName} who will validate this completed course.`,
                                  es:
                                    "Elija el validador que validará este curso completado.",
                                },
                              )
                              : employeeText(
                                sql`course_assignment.employee_language`,
                                {
                                  en:
                                    `Choose the ${validationLabels.primaryStageDisplayName} and ${validationLabels.secondaryStageDisplayName} who will validate this completed course.`,
                                  es:
                                    "Elija los validadores que validarán este curso completado.",
                                },
                              )
                          }
                              else ${
                            employeeText(
                              sql`course_assignment.employee_language`,
                              {
                                en:
                                  `Choose the ${validationLabels.primaryStageDisplayName} who will validate this completed course.`,
                                es:
                                  "Elija el validador que validará este curso completado.",
                              },
                            )
                          }
                            end`
                          : employeeText(
                            sql`course_assignment.employee_language`,
                            {
                              en:
                                "Sign to confirm you completed every required step.",
                              es:
                                "Firme para confirmar que completó todos los pasos requeridos.",
                            },
                          )}
                      </Typography>
                      <Show when={sql`signature_error is not null`}>
                        <Alert
                          color="danger"
                          startIcon="Error"
                          className="mt-3"
                        >
                          {sql`signature_error`}
                        </Alert>
                      </Show>
                      <div className="mt-3 grid gap-4">
                        <Show
                          when={sql`course_assignment.employee_final_signed_at is null`}
                          fallback={
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {validationEnabled && (
                                <>
                                  <div className="rounded-md border border-divider bg-white p-3">
                                    <Typography
                                      level="body-sm"
                                      className="text-neutral-600"
                                    >
                                      {employeeText(
                                        sql`course_assignment.employee_language`,
                                        {
                                          en: validationLabels
                                            .primaryStageDisplayName,
                                          es: validationLabels
                                            .primaryStageDisplayName,
                                        },
                                      )}
                                    </Typography>
                                    <Typography level="title-sm">
                                      {sql`coalesce(course_assignment.final_primary_validator_name, '')`}
                                    </Typography>
                                  </div>
                                  <Show
                                    when={sql`course_assignment.generates_certification`}
                                  >
                                    <div className="rounded-md border border-divider bg-white p-3">
                                      <Typography
                                        level="body-sm"
                                        className="text-neutral-600"
                                      >
                                        {employeeText(
                                          sql`course_assignment.employee_language`,
                                          {
                                            en: validationLabels
                                              .secondaryStageDisplayName,
                                            es: validationLabels
                                              .secondaryStageDisplayName,
                                          },
                                        )}
                                      </Typography>
                                      <Typography level="title-sm">
                                        {secondaryByPermission
                                          ? sql`coalesce(course_assignment.final_secondary_validator_name, 'Any eligible signer')`
                                          : sql`coalesce(course_assignment.final_secondary_validator_name, '')`}
                                      </Typography>
                                    </div>
                                  </Show>
                                </>
                              )}
                            </div>
                          }
                        >
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {validationEnabled && (
                              <>
                                <FormControl>
                                  <FormLabel>
                                    {employeeText(
                                      sql`course_assignment.employee_language`,
                                      {
                                        en: validationLabels
                                          .primaryStageDisplayName,
                                        es: validationLabels
                                          .primaryStageDisplayName,
                                      },
                                    )}
                                  </FormLabel>
                                  <Select
                                    value={sql`coalesce(final_primary_validator_id, course_assignment.final_primary_validator_id)::string`}
                                    onInput={(s) =>
                                      s.setScalar(
                                        "final_primary_validator_id",
                                        sql`nullif(target_value, '')::bigint`,
                                      )}
                                  >
                                    <Select.Option value="">
                                      {employeeText(
                                        sql`course_assignment.employee_language`,
                                        {
                                          en:
                                            `Select ${validationLabels.primaryStageDisplayName}`,
                                          es: "Seleccione validador",
                                        },
                                      )}
                                    </Select.Option>
                                    <Each
                                      table="primary_validator_options"
                                      recordName="validator"
                                    >
                                      <Select.Option
                                        value={sql`validator.id::string`}
                                      >
                                        {sql`validator.name`}
                                      </Select.Option>
                                    </Each>
                                  </Select>
                                </FormControl>
                                {!secondaryByPermission && (
                                  <Show
                                    when={sql`course_assignment.generates_certification`}
                                  >
                                    <FormControl>
                                      <FormLabel>
                                        {employeeText(
                                          sql`course_assignment.employee_language`,
                                          {
                                            en: validationLabels
                                              .secondaryStageDisplayName,
                                            es: validationLabels
                                              .secondaryStageDisplayName,
                                          },
                                        )}
                                      </FormLabel>
                                      <Select
                                        value={sql`coalesce(final_secondary_validator_id, course_assignment.final_secondary_validator_id)::string`}
                                        onInput={(s) =>
                                          s.setScalar(
                                            "final_secondary_validator_id",
                                            sql`nullif(target_value, '')::bigint`,
                                          )}
                                      >
                                        <Select.Option value="">
                                          {employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en:
                                                `Select ${validationLabels.secondaryStageDisplayName}`,
                                              es: "Seleccione validador",
                                            },
                                          )}
                                        </Select.Option>
                                        <Each
                                          table="secondary_validator_options"
                                          recordName="validator"
                                        >
                                          <Select.Option
                                            value={sql`validator.id::string`}
                                          >
                                            {sql`validator.name`}
                                          </Select.Option>
                                        </Each>
                                      </Select>
                                    </FormControl>
                                  </Show>
                                )}
                              </>
                            )}
                          </div>
                        </Show>
                        <Show
                          when={sql`course_assignment.employee_final_signed_at is null`}
                          fallback={
                            <div className="rounded-md border border-divider bg-white p-3">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <Chip size="sm" variant="soft" color="success">
                                  {employeeText(
                                    sql`course_assignment.employee_language`,
                                    {
                                      en: "Employee signed",
                                      es: "Empleado firmó",
                                    },
                                  )}
                                </Chip>
                                <Typography
                                  level="body-sm"
                                  className="text-neutral-600"
                                >
                                  {formatDateTimeSql(
                                    sql`course_assignment.employee_final_signed_at`,
                                  )}
                                </Typography>
                              </div>
                              <img
                                src={sql`course_assignment.employee_final_signature_data`}
                                alt="Employee final signature"
                                className="h-24 max-w-full object-contain"
                              />
                            </div>
                          }
                        >
                          <SignaturePad
                            label={employeeText(
                              sql`course_assignment.employee_language`,
                              {
                                en: "Employee final signature",
                                es: "Firma final del empleado",
                              },
                            )}
                            onSigned={(s, signatureData) => {
                              s.setScalar("signature_error", sql`null`);
                              s.tryServer({
                                body: (s) => {
                                  if (validationEnabled) {
                                    s.if(
                                      sql`coalesce(ui.final_primary_validator_id, course_assignment.final_primary_validator_id) is null`,
                                      (s) => {
                                        s.setScalar(
                                          "ui.signature_error",
                                          employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en:
                                                `Choose the ${validationLabels.primaryStageDisplayName} before signing the course.`,
                                              es:
                                                "Elija el validador antes de firmar el curso.",
                                            },
                                          ),
                                        );
                                        s.return();
                                      },
                                    );
                                    s.if(
                                      sql`course_assignment.generates_certification
                                        and ${
                                        secondaryByPermission
                                          ? sql`false`
                                          : sql`true`
                                      }
                                        and coalesce(
                                          ui.final_secondary_validator_id,
                                          course_assignment.final_secondary_validator_id
                                        ) is null`,
                                      (s) => {
                                        s.setScalar(
                                          "ui.signature_error",
                                          employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en:
                                                `Choose the ${validationLabels.secondaryStageDisplayName} before signing the course.`,
                                              es:
                                                "Elija el validador antes de firmar el curso.",
                                            },
                                          ),
                                        );
                                        s.return();
                                      },
                                    );
                                    s.if(
                                      sql`not exists (
                                        select 1
                                        from primary_validator_options validator
                                        where validator.id = coalesce(
                                          ui.final_primary_validator_id,
                                          course_assignment.final_primary_validator_id
                                        )
                                      )`,
                                      (s) => {
                                        s.setScalar(
                                          "ui.signature_error",
                                          employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en:
                                                `Selected ${validationLabels.primaryStageDisplayName} is not eligible to sign.`,
                                              es:
                                                "El validador seleccionado no puede firmar.",
                                            },
                                          ),
                                        );
                                        s.return();
                                      },
                                    );
                                    s.if(
                                      sql`course_assignment.generates_certification
                                        and ${
                                        secondaryByPermission
                                          ? sql`false`
                                          : sql`true`
                                      }
                                        and not exists (
                                        select 1
                                        from secondary_validator_options validator
                                        where validator.id = coalesce(
                                          ui.final_secondary_validator_id,
                                          course_assignment.final_secondary_validator_id
                                        )
                                      )`,
                                      (s) => {
                                        s.setScalar(
                                          "ui.signature_error",
                                          employeeText(
                                            sql`course_assignment.employee_language`,
                                            {
                                              en:
                                                `Selected ${validationLabels.secondaryStageDisplayName} is not eligible to sign.`,
                                              es:
                                                "El validador seleccionado no puede firmar.",
                                            },
                                          ),
                                        );
                                        s.return();
                                      },
                                    );
                                  }
                                  s.startTransaction();
                                  s.throwErrorIf(
                                    sql`nullif(trim(coalesce(${signatureData}, '')), '') is null`,
                                    sql.lit`A final signature is required.`,
                                  );
                                  s.throwErrorIf(
                                    sql`not exists (
                                      select 1
                                      from db.training_assignments assignment
                                      join db.training_courses course
                                        on course.id = assignment.training_course_id
                                      where assignment.id = ui.training_assignment_id
                                        and assignment.person_id = ui.person_id
                                        and assignment.status = 'in_progress'
                                        and assignment.employee_final_signed_at is null
                                        and course.requires_final_signature
                                        and not exists (
                                          select 1
                                          from db.training_employee_tasks open_task
                                          where open_task.training_assignment_id = assignment.id
                                            and open_task.status in ('assigned', 'in_progress')
                                        )
                                    )`,
                                    sql
                                      .lit`This assignment is not ready for a final signature.`,
                                  );
                                  s.modify(sql`
                                    update db.training_assignments
                                    set final_primary_validator_id = ${
                                    validationEnabled
                                      ? sql`coalesce(
                                          ui.final_primary_validator_id,
                                          course_assignment.final_primary_validator_id
                                        )`
                                      : sql`null`
                                  },
                                        final_secondary_validator_id = ${
                                    validationEnabled
                                      ? sql`case
                                          when course_assignment.generates_certification
                                            and ${
                                        secondaryByPermission
                                          ? sql`false`
                                          : sql`true`
                                      }
                                          then coalesce(
                                            ui.final_secondary_validator_id,
                                            course_assignment.final_secondary_validator_id
                                          )
                                          else null
                                        end`
                                      : sql`null`
                                  },
                                        employee_final_signature_data =
                                          ${signatureData},
                                        employee_final_signed_at = now()
                                    where id = ui.training_assignment_id
                                      and person_id = ui.person_id
                                      and status = 'in_progress'
                                      and employee_final_signed_at is null
                                  `);
                                  s.modify(
                                    updateAssignmentStatusAfterTaskCompletionSql(
                                      {
                                        opts: block.opts,
                                        assignmentId:
                                          sql`ui.training_assignment_id`,
                                      },
                                    ),
                                  );
                                  if (
                                    trainingFeatureEnabled(
                                      block.opts,
                                      "inviteAccess",
                                    )
                                  ) {
                                    s.modify(
                                      revokeTrainingAccessTokensForClosedAssignmentSql(
                                        {
                                          opts: block.opts,
                                          assignmentId:
                                            sql`ui.training_assignment_id`,
                                        },
                                      ),
                                    );
                                  }
                                  s.commitTransaction();
                                  createCertificationForCompletedAssignment(
                                    s,
                                    {
                                      opts: block.opts,
                                      assignmentId:
                                        sql`ui.training_assignment_id`,
                                    },
                                  );
                                  s.refetch();
                                },
                              });
                            }}
                          />
                        </Show>
                      </div>
                    </div>
                  </Show>
                  <Show
                    when={validationEnabled
                      ? sql`course_assignment.done_tasks = course_assignment.total_tasks
                      and course_assignment.employee_final_signed_at is not null
                      and course_assignment.final_primary_validator_id is not null`
                      : sql`false`}
                  >
                    <div className="mt-5 rounded-md border border-divider bg-neutral-50 p-4">
                      <Typography level="title-md" startIcon="Rule">
                        {validationLabels.validatorGenericLabel} validation
                      </Typography>
                      <Show when={sql`validation_error is not null`}>
                        <Alert
                          color="danger"
                          startIcon="Error"
                          className="mt-3"
                        >
                          {sql`validation_error`}
                        </Alert>
                      </Show>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <ValidatorSignoffCard
                          block={props.block}
                          stage="primary"
                        />
                        <Show
                          when={sql`course_assignment.generates_certification`}
                        >
                          <ValidatorSignoffCard
                            block={props.block}
                            stage="secondary"
                          />
                        </Show>
                        <Each
                          table="assignment_validations"
                          recordName="assignment_validation"
                        >
                          <div className="p-3 rounded-md bg-white border border-divider">
                            <Typography
                              level="body-sm"
                              className="text-neutral-600"
                            >
                              {sql`assignment_validation.validation_stage_name`}
                            </Typography>
                            <Typography level="title-sm">
                              {sql`assignment_validation.validator_signature_name`}
                            </Typography>
                            <Typography
                              level="body-sm"
                              className="text-neutral-600"
                            >
                              {sql`coalesce(assignment_validation.validator_name, 'Validator') || ' · ' || ${
                                formatDateTimeSql(
                                  sql`assignment_validation.validated_at`,
                                )
                              }`}
                            </Typography>
                            <Show
                              when={sql`assignment_validation.validator_signature_data is not null`}
                            >
                              <div className="mt-2 rounded-md border border-divider bg-white p-2">
                                <img
                                  src={sql`assignment_validation.validator_signature_data`}
                                  alt="Manager validation signature"
                                  className="h-24 max-w-full object-contain"
                                />
                              </div>
                            </Show>
                          </div>
                        </Each>
                      </div>
                    </div>
                  </Show>
                </CardContent>
              </Card>
            </div>
          </PageShell>
        </Show>
      </Data>
    </Data>
  );
}

function EmployeeAssessmentStateChip(props: { state: Sql; language: Sql }) {
  return (
    <StatusChip
      fallbackLabel={props.state}
      cases={[
        {
          when: sql`${props.state} = 'not_started'`,
          label: employeeText(props.language, {
            en: "Not started",
            es: "Sin iniciar",
          }),
          color: "neutral",
        },
        {
          when: sql`${props.state} = 'in_progress'`,
          label: employeeText(props.language, {
            en: "In progress",
            es: "En progreso",
          }),
          color: "primary",
        },
        {
          when: sql`${props.state} = 'review_pending'`,
          label: employeeText(props.language, {
            en: "Review pending",
            es: "Revisión pendiente",
          }),
          color: "warning",
        },
        {
          when: sql`${props.state} = 'passed'`,
          label: employeeText(props.language, {
            en: "Passed",
            es: "Aprobada",
          }),
          color: "success",
        },
        {
          when: sql`${props.state} = 'failed_retake_available'`,
          label: employeeText(props.language, {
            en: "Failed - retake available",
            es: "Reprobada - reintento disponible",
          }),
          color: "danger",
        },
        {
          when: sql`${props.state} = 'failed_final'`,
          label: employeeText(props.language, {
            en: "Failed - final",
            es: "Reprobada - final",
          }),
          color: "danger",
        },
      ]}
    />
  );
}

function EmployeeAssessmentTaskPage(
  props: { block: TrainingBlock; accessToken?: Sql },
) {
  const block = props.block;
  const startAttempt = (s: DomStatements) => {
    s.setScalar("assessment_error", sql`null`);
    s.tryServer({
      body: (s) => {
        s.callStoredProcedure("training_start_assessment_attempt", {
          inputScalars: {
            p_task_id: sql`assessment_task.id`,
            p_access_token: props.accessToken ?? sql`cast(null as string)`,
          },
        });
        s.refetch();
      },
      catch: (s) => {
        s.setScalar(
          "assessment_error",
          employeeText(sql`assessment_task.employee_language`, {
            en: "The assessment attempt could not be started.",
            es: "No se pudo iniciar la evaluación.",
          }),
        );
      },
    });
  };
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("assessment_error", {
          type: { type: "String", maxLength: 1000 },
        });
      }}
    >
      <Data
        procedure={(s) => {
          s.defScalar(
            "person_id",
            props.accessToken
              ? sql`(
                select token_assignment.person_id
                from db.training_access_tokens token
                join db.training_assignments token_assignment
                  on token_assignment.id = token.training_assignment_id
                join db.training_employee_tasks token_task
                  on token_task.training_assignment_id =
                    token.training_assignment_id
                 and token_task.id = ui.training_task_id
                where token.token = ${props.accessToken}
                  and token.revoked_at is null
                  and token.expires_at > now()
                  and ${openTrainingAssignmentWhereSql(sql`token_assignment`)}
                limit 1
              )`
              : currentEmployeeId(block.opts),
          );
          s.defRecord(
            "assessment_task",
            sql`select t.id, t.status, a.person_id, t.training_assignment_id,
                       t.due_date,
                       i.content as step_content,
                       a.training_course_id as course_assignment_id,
                       assessment.id as assessment_id,
                       assessment.name as assessment_name,
                       assessment.execution_mode,
                       ${personLanguageSql(block.opts, sql`person`)}
                         as employee_language,
                       (select task_state.derived_state
                        from db.training_task_derived_state task_state
                        where task_state.task_id = t.id)
                         as assessment_state
                from db.training_employee_tasks t
                join db.training_assignments a
                  on a.id = t.training_assignment_id
                join db.${sql.ref(personTable(block.opts))} person
                  on person.id = a.person_id
                join db.training_course_section_items i
                  on i.id = t.training_course_section_item_id
                 and i.type = 'assessment'
                join db.training_assessments assessment
                  on assessment.id = i.training_assessment_id
                where t.id = ui.training_task_id
                  and a.person_id = ui.person_id
                  ${
              props.accessToken
                ? sql`and exists (
                    select 1
                    from db.training_access_tokens token
                    where token.token = ${props.accessToken}
                      and token.revoked_at is null
                      and token.expires_at > now()
                      and token.training_assignment_id = t.training_assignment_id
                      and ${openTrainingAssignmentWhereSql(sql`a`)}
                  )`
                : sql``
            }`,
          );
          s.defRecord(
            "display_attempt",
            sql`select att.id, att.status, att.outcome, att.attempt_number,
                       att.score_points, att.max_points, att.score_percent,
                       v.version_label, v.show_correct_answers_after_submission,
                       v.show_failed_attempts_to_employee
                from db.training_assessment_attempts att
                join db.training_assessment_versions v
                  on v.id = att.training_assessment_version_id
                where att.training_employee_task_id = ui.training_task_id
                  and att.status != 'cancelled'
                order by att.attempt_number desc, att.id desc
                limit 1`,
          );
          s.defTable(
            "assessment_metadata_responses",
            sql`select r.id as response_id, r.text_value, r.number_value,
                       r.date_value, r.selected_choice_id,
                       field.id as field_id, field.key as name, field.label,
                       field.type, field.required, field.ordinal,
                       field.help_text
                from db.training_assessment_metadata_responses r
                join db.training_assessment_metadata_fields field
                  on field.id = r.training_assessment_metadata_field_id
                where r.training_assessment_attempt_id = display_attempt.id
                order by field.ordinal, field.id`,
          );
          s.defTable(
            "assessment_metadata_choices",
            sql`select choice.id, choice.label, choice.value,
                       choice.training_assessment_metadata_field_id
                         as field_id
                from db.training_assessment_metadata_field_choices choice
                join db.training_assessment_metadata_fields field
                  on field.id =
                    choice.training_assessment_metadata_field_id
                where field.training_assessment_version_id = (
                  select att.training_assessment_version_id
                  from db.training_assessment_attempts att
                  where att.id = display_attempt.id
                )
                order by choice.sort_order, choice.id`,
          );
          s.defTable(
            "assessment_responses",
            sql`select r.id as response_id, r.text_response,
                       r.signature_name, r.signature_data, r.practical_result,
                       r.points_awarded, r.max_points as response_max_points,
                       r.include_in_score, r.is_correct,
                       item.id as item_id, item.type, item.prompt,
                       item.help_text, item.is_required, item.ordinal,
                       item.selection_mode, item.explanation,
                       item.remediation_text,
                       section.name as section_name,
                       section.ordinal as section_ordinal
                from db.training_assessment_responses r
                join db.training_assessment_items item
                  on item.id = r.training_assessment_item_id
                join db.training_assessment_sections section
                  on section.id = item.training_assessment_section_id
                where r.training_assessment_attempt_id = display_attempt.id
                order by section.ordinal, item.ordinal, item.id`,
          );
          s.defTable(
            "assessment_choices",
            sql`select choice.id, choice.content, choice.is_correct,
                       choice.explanation,
                       choice.training_assessment_item_id as item_id,
                       exists (
                         select 1
                         from db.training_assessment_response_selected_choices sc
                         join db.training_assessment_responses r
                           on r.id = sc.training_assessment_response_id
                         where r.training_assessment_attempt_id =
                           display_attempt.id
                           and sc.training_assessment_item_choice_id =
                             choice.id
                       ) as selected
                from db.training_assessment_item_choices choice
                join db.training_assessment_items item
                  on item.id = choice.training_assessment_item_id
                join db.training_assessment_sections section
                  on section.id = item.training_assessment_section_id
                where section.training_assessment_version_id = (
                  select att.training_assessment_version_id
                  from db.training_assessment_attempts att
                  where att.id = display_attempt.id
                )
                order by choice.sort_order, choice.id`,
          );
        }}
      >
        <Show
          when={sql`assessment_task.id is not null`}
          fallback={
            <AccessProblemNotice
              block={props.block}
              kind={props.accessToken ? "invite" : "task"}
            />
          }
        >
          <Effect
            watch={[sql`assessment_task.id`, sql`display_attempt.id`]}
            triggerOnMount
            onChange={(s) => {
              s.if(
                sql`assessment_task.id is not null
                  and display_attempt.id is null
                  and assessment_task.execution_mode != 'trainer_recorded'`,
                startAttempt,
              );
            }}
          />
          <PageShell
            title={sql`assessment_task.assessment_name`}
            subtitle={sql`coalesce(${
              relativeDueSql(
                sql`assessment_task.employee_language`,
                sql`assessment_task.due_date`,
              )
            }, '')`}
          >
            <div className="max-w-4xl mx-auto">
              <div className="mb-3">
                <Button
                  component="a"
                  href={employeeCourseHref(
                    props.block,
                    sql`assessment_task.training_assignment_id`,
                    props.accessToken,
                  )}
                  variant="plain"
                  color="neutral"
                  size="sm"
                  startIcon="ArrowBack"
                >
                  {employeeText(sql`assessment_task.employee_language`, {
                    en: "Back to course",
                    es: "Volver al curso",
                  })}
                </Button>
              </div>
              <Show when={sql`assessment_error is not null`}>
                <Alert color="danger" startIcon="Error" className="mb-4">
                  {sql`assessment_error`}
                </Alert>
              </Show>
              <Card variant="outlined">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 w-full">
                    <div>
                      <Typography level="title-lg" startIcon="Quiz">
                        {sql`assessment_task.step_content`}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {employeeText(sql`assessment_task.employee_language`, {
                          en:
                            "Complete the assessment and submit your answers.",
                          es: "Complete la evaluación y envíe sus respuestas.",
                        })}
                      </Typography>
                    </div>
                    <EmployeeAssessmentStateChip
                      state={sql`assessment_task.assessment_state`}
                      language={sql`assessment_task.employee_language`}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <Show
                    when={sql`assessment_task.execution_mode =
                      'trainer_recorded'`}
                  >
                    <Alert color="warning" startIcon="FactCheck">
                      {employeeText(sql`assessment_task.employee_language`, {
                        en:
                          "A trainer must record this evaluation. It is not available for employee entry.",
                        es:
                          "Un instructor debe registrar esta evaluación. No está disponible para ingreso del empleado.",
                      })}
                    </Alert>
                  </Show>
                  <Show when={sql`display_attempt.id is not null`}>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`'Attempt ' ||
                          display_attempt.attempt_number::string ||
                          ' · ' || display_attempt.version_label`}
                      </Chip>
                      <Show
                        when={sql`display_attempt.score_percent is not null
                          and (
                            display_attempt.outcome != 'failed'
                            or display_attempt.show_failed_attempts_to_employee
                          )`}
                      >
                        <Chip size="sm" variant="soft" color="neutral">
                          {sql`coalesce(display_attempt.score_points::string, '0')
                            || ' / ' ||
                            coalesce(display_attempt.max_points::string, '0')
                            || ' pts · ' ||
                            round(display_attempt.score_percent)::string ||
                            '%'`}
                        </Chip>
                      </Show>
                    </div>
                    <Show
                      when={sql`display_attempt.outcome != 'failed'
                        or display_attempt.show_failed_attempts_to_employee`}
                      fallback={
                        <Alert color="neutral" startIcon="VisibilityOff">
                          {employeeText(
                            sql`assessment_task.employee_language`,
                            {
                              en:
                                "The details of this failed attempt are not shown.",
                              es:
                                "No se muestran los detalles de este intento reprobado.",
                            },
                          )}
                        </Alert>
                      }
                    >
                      <EmployeeAssessmentMetadataResponses
                        accessToken={props.accessToken}
                      />
                      <EmployeeAssessmentResponses
                        block={props.block}
                        accessToken={props.accessToken}
                      />
                    </Show>
                    <Show
                      when={sql`display_attempt.status = 'in_progress'
                        and assessment_task.execution_mode !=
                          'trainer_recorded'`}
                    >
                      <div className="flex justify-end mt-4">
                        <Button
                          startIcon="Done"
                          onClick={(s) => {
                            s.setScalar("assessment_error", sql`null`);
                            s.tryServer({
                              body: (s) => {
                                s.callStoredProcedure(
                                  "training_submit_assessment_attempt",
                                  {
                                    inputScalars: {
                                      p_attempt_id: sql`display_attempt.id`,
                                      p_access_token: props.accessToken ??
                                        sql`cast(null as string)`,
                                    },
                                  },
                                );
                                s.refetch();
                              },
                              catch: (s) => {
                                s.setScalar(
                                  "assessment_error",
                                  employeeText(
                                    sql`assessment_task.employee_language`,
                                    {
                                      en:
                                        "The assessment could not be submitted. Check that every required question is answered.",
                                      es:
                                        "No se pudo enviar la evaluación. Verifique que todas las preguntas obligatorias estén respondidas.",
                                    },
                                  ),
                                );
                              },
                            });
                          }}
                        >
                          {employeeText(
                            sql`assessment_task.employee_language`,
                            {
                              en: "Submit assessment",
                              es: "Enviar evaluación",
                            },
                          )}
                        </Button>
                      </div>
                    </Show>
                    <Show
                      when={sql`assessment_task.assessment_state =
                        'review_pending'`}
                    >
                      <Alert
                        color="warning"
                        startIcon="RateReview"
                        className="mt-4"
                      >
                        {employeeText(sql`assessment_task.employee_language`, {
                          en: "Your submission is waiting for trainer review.",
                          es:
                            "Su envío está esperando revisión del instructor.",
                        })}
                      </Alert>
                    </Show>
                    <Show
                      when={sql`assessment_task.assessment_state = 'passed'`}
                    >
                      <Alert
                        color="success"
                        startIcon="CheckCircle"
                        className="mt-4"
                      >
                        {employeeText(sql`assessment_task.employee_language`, {
                          en: "This assessment is passed.",
                          es: "Esta evaluación está aprobada.",
                        })}
                      </Alert>
                    </Show>
                    <Show
                      when={sql`assessment_task.assessment_state =
                        'failed_retake_available'`}
                    >
                      <Alert color="danger" startIcon="Error" className="mt-4">
                        {employeeText(sql`assessment_task.employee_language`, {
                          en:
                            "This attempt did not pass. A retake is available.",
                          es:
                            "Este intento no fue aprobado. Hay un reintento disponible.",
                        })}
                      </Alert>
                      <div className="flex justify-end mt-3">
                        <Button startIcon="Replay" onClick={startAttempt}>
                          {employeeText(
                            sql`assessment_task.employee_language`,
                            {
                              en: "Start retake",
                              es: "Iniciar reintento",
                            },
                          )}
                        </Button>
                      </div>
                    </Show>
                    <Show
                      when={sql`assessment_task.assessment_state =
                        'failed_final'`}
                    >
                      <Alert color="danger" startIcon="Block" className="mt-4">
                        {employeeText(sql`assessment_task.employee_language`, {
                          en:
                            "This assessment is failed and no more retakes are available. A manager must waive, reassign, or update the policy.",
                          es:
                            "Esta evaluación está reprobada y no hay más reintentos disponibles. Un gerente debe eximir, reasignar o actualizar la política.",
                        })}
                      </Alert>
                    </Show>
                  </Show>
                </CardContent>
              </Card>
            </div>
          </PageShell>
        </Show>
      </Data>
    </Data>
  );
}

function EmployeeAssessmentResponses(
  props: { block: TrainingBlock; accessToken?: Sql },
) {
  const saveResponse = (
    s: UiServerStatements,
    field: "textResponse" | "signatureName" | "signatureData",
    value: Sql,
  ) =>
    callSaveAssessmentResponse(s, {
      attemptId: sql`display_attempt.id`,
      itemId: sql`assessment_response.item_id`,
      field,
      value,
      accessToken: props.accessToken,
    });
  return (
    <div className="flex flex-col gap-3">
      <Each table="assessment_responses" recordName="assessment_response">
        <div className="border border-divider rounded-md p-4 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Typography level="body-sm" className="text-neutral-500">
                {sql`assessment_response.section_name`}
              </Typography>
              <Typography level="title-sm">
                {sql`assessment_response.prompt ||
                  case when assessment_response.is_required
                    then '' else ' (optional)' end`}
              </Typography>
              <Show when={sql`assessment_response.help_text is not null`}>
                <Typography level="body-sm" className="text-neutral-600">
                  {sql`assessment_response.help_text`}
                </Typography>
              </Show>
            </div>
            <Show
              when={sql`display_attempt.status = 'complete'
                and assessment_response.include_in_score`}
            >
              <Chip size="sm" variant="soft" color="neutral">
                {sql`coalesce(assessment_response.points_awarded::string, '0')
                  || ' / ' ||
                  assessment_response.response_max_points::string || ' pts'`}
              </Chip>
            </Show>
          </div>
          <div className="mt-3">
            <Show when={sql`assessment_response.type = 'multiple_choice'`}>
              <div className="flex flex-col gap-1">
                <Each
                  table="assessment_choices"
                  recordName="assessment_choice"
                  where={sql`assessment_choice.item_id =
                    assessment_response.item_id`}
                >
                  <Show
                    when={sql`display_attempt.status = 'in_progress'
                      and assessment_task.execution_mode !=
                        'trainer_recorded'`}
                    fallback={
                      <div className="flex flex-col gap-1">
                        <Typography level="body-sm">
                          {sql`case when assessment_choice.selected
                            then '☑ ' else '☐ ' end ||
                            assessment_choice.content`}
                        </Typography>
                        <Show
                          when={sql`display_attempt.status = 'complete'
                            and display_attempt.show_correct_answers_after_submission`}
                        >
                          <Typography
                            level="body-xs"
                            className="text-neutral-500"
                          >
                            {sql`case
                              when assessment_choice.is_correct
                              then 'Correct answer'
                              else 'Incorrect choice'
                            end || coalesce(
                              ' · ' || assessment_choice.explanation,
                              ''
                            )`}
                          </Typography>
                        </Show>
                      </div>
                    }
                  >
                    <Checkbox
                      checked={sql`assessment_choice.selected`}
                      label={sql`assessment_choice.content`}
                      onCheckboxChange={(s) => {
                        s.setScalar("ui.assessment_error", sql`null`);
                        s.tryServer({
                          body: (s) => {
                            s.startTransaction();
                            s.if(
                              sql`assessment_response.selection_mode =
                                'single'`,
                              (s) => {
                                for (
                                  const statement
                                    of selectAssessmentSingleChoiceSql({
                                      attemptId: sql`display_attempt.id`,
                                      itemId: sql`assessment_response.item_id`,
                                      choiceId: sql`assessment_choice.id`,
                                    })
                                ) {
                                  s.modify(statement);
                                }
                              },
                              (s) => {
                                s.if(
                                  sql`target_checked`,
                                  (s) => {
                                    s.modify(
                                      insertAssessmentChoiceSelectionSql({
                                        attemptId: sql`display_attempt.id`,
                                        itemId:
                                          sql`assessment_response.item_id`,
                                        choiceId: sql`assessment_choice.id`,
                                      }),
                                    );
                                  },
                                  (s) => {
                                    s.modify(
                                      deleteAssessmentChoiceSelectionSql({
                                        attemptId: sql`display_attempt.id`,
                                        itemId:
                                          sql`assessment_response.item_id`,
                                        choiceId: sql`assessment_choice.id`,
                                      }),
                                    );
                                  },
                                );
                              },
                            );
                            s.commitTransaction();
                            s.refetch();
                          },
                          catch: (s) => {
                            s.setScalar(
                              "ui.assessment_error",
                              employeeText(
                                sql`assessment_task.employee_language`,
                                {
                                  en: "The answer could not be saved.",
                                  es: "No se pudo guardar la respuesta.",
                                },
                              ),
                            );
                          },
                        });
                      }}
                    />
                  </Show>
                </Each>
                <Show
                  when={sql`display_attempt.status = 'complete'
                    and display_attempt.show_correct_answers_after_submission
                    and nullif(trim(assessment_response.explanation), '')
                      is not null`}
                >
                  <Alert color="neutral" startIcon="Info" className="mt-3">
                    <Typography level="body-xs" className="font-medium">
                      {employeeText(
                        sql`assessment_task.employee_language`,
                        { en: "Explanation", es: "Explicación" },
                      )}
                    </Typography>
                    <Typography level="body-sm" className="whitespace-pre-wrap">
                      {sql`assessment_response.explanation`}
                    </Typography>
                  </Alert>
                </Show>
                <Show
                  when={sql`display_attempt.status = 'complete'
                    and display_attempt.show_correct_answers_after_submission
                    and assessment_response.is_correct = false
                    and nullif(trim(assessment_response.remediation_text), '')
                      is not null`}
                >
                  <Alert color="warning" startIcon="School" className="mt-3">
                    <Typography level="body-xs" className="font-medium">
                      {employeeText(
                        sql`assessment_task.employee_language`,
                        { en: "Review", es: "Repaso" },
                      )}
                    </Typography>
                    <Typography level="body-sm" className="whitespace-pre-wrap">
                      {sql`assessment_response.remediation_text`}
                    </Typography>
                  </Alert>
                </Show>
              </div>
            </Show>
            <Show when={sql`assessment_response.type = 'text_response'`}>
              <Show
                when={sql`display_attempt.status = 'in_progress'
                  and assessment_task.execution_mode != 'trainer_recorded'`}
                fallback={
                  <Typography level="body-sm" className="whitespace-pre-wrap">
                    {sql`coalesce(assessment_response.text_response,
                      'No response.')`}
                  </Typography>
                }
              >
                <Textarea
                  value={sql`coalesce(assessment_response.text_response, '')`}
                  minRows={4}
                  onInput={(s) => {
                    s.tryServer({
                      body: (s) => {
                        saveResponse(s, "textResponse", sql`target_value`);
                      },
                    });
                  }}
                />
              </Show>
            </Show>
            <Show when={sql`assessment_response.type = 'signature'`}>
              <Show
                when={sql`display_attempt.status = 'in_progress'
                  and assessment_task.execution_mode != 'trainer_recorded'`}
                fallback={
                  <div>
                    <Typography level="body-sm">
                      {sql`coalesce('Signed: ' ||
                        assessment_response.signature_name, 'Not signed.')`}
                    </Typography>
                    <Show
                      when={sql`assessment_response.signature_data is not null`}
                    >
                      <img
                        src={sql`assessment_response.signature_data`}
                        alt="Signature"
                        className="mt-2 max-h-24 border border-divider rounded-md bg-white"
                      />
                    </Show>
                  </div>
                }
              >
                <SignaturePad
                  label={employeeText(sql`assessment_task.employee_language`, {
                    en: "Draw your signature",
                    es: "Dibuje su firma",
                  })}
                  onSigned={(s, signatureData) => {
                    s.tryServer({
                      body: (s) => {
                        saveResponse(
                          s,
                          "signatureName",
                          sql`(
                            select ${
                            employeeName(
                              props.block.opts,
                              sql`signature_person`,
                            )
                          }
                            from db.${
                            sql.ref(personTable(props.block.opts))
                          } signature_person
                            where signature_person.id =
                              assessment_task.person_id
                          )`,
                        );
                        saveResponse(s, "signatureData", signatureData);
                        s.refetch();
                      },
                    });
                  }}
                />
              </Show>
            </Show>
            <Show
              when={sql`assessment_response.type =
                'practical_observation'`}
            >
              <Alert color="warning" startIcon="FactCheck">
                {employeeText(sql`assessment_task.employee_language`, {
                  en: "A trainer records this practical observation.",
                  es: "Un instructor registra esta observación práctica.",
                })}
              </Alert>
            </Show>
          </div>
        </div>
      </Each>
    </div>
  );
}

function EmployeeAssessmentMetadataResponses(
  props: { accessToken?: Sql },
) {
  const editable = sql`display_attempt.status = 'in_progress'
    and assessment_task.execution_mode != 'trainer_recorded'`;
  const saveMetadata = (
    s: UiServerStatements,
    field:
      | "textValue"
      | "numberValue"
      | "dateValue"
      | "selectedChoiceId",
    value: Sql,
  ) =>
    callSaveAssessmentMetadataResponse(s, {
      attemptId: sql`display_attempt.id`,
      fieldId: sql`metadata_response.field_id`,
      field,
      value,
      accessToken: props.accessToken,
    });
  return (
    <Show when={sql`exists (select 1 from assessment_metadata_responses)`}>
      <div className="border border-divider rounded-md p-4 bg-neutral-50 mb-4">
        <Typography level="title-sm" className="mb-3">
          Assessment details
        </Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Each
            table="assessment_metadata_responses"
            recordName="metadata_response"
          >
            <FormControl>
              <FormLabel>
                {sql`metadata_response.label ||
                  case when metadata_response.required
                    then '' else ' (optional)' end`}
              </FormLabel>
              <Show when={sql`metadata_response.help_text is not null`}>
                <Typography level="body-xs" className="text-neutral-600 mb-1">
                  {sql`metadata_response.help_text`}
                </Typography>
              </Show>
              <Show
                when={editable}
                fallback={
                  <Typography level="body-sm">
                    {sql`case metadata_response.type::string
                      when 'text' then coalesce(
                        metadata_response.text_value, 'Not recorded')
                      when 'number' then coalesce(
                        metadata_response.number_value::string,
                        'Not recorded')
                      when 'date' then coalesce(
                        ${formatDateSql(sql`metadata_response.date_value`)},
                        'Not recorded')
                      else coalesce((
                        select choice.label
                        from assessment_metadata_choices choice
                        where choice.id =
                          metadata_response.selected_choice_id
                      ), 'Not recorded')
                    end`}
                  </Typography>
                }
              >
                <Show when={sql`metadata_response.type = 'text'`}>
                  <Input
                    value={sql`coalesce(metadata_response.text_value, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(s, "textValue", sql`target_value`);
                        },
                      });
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'number'`}>
                  <Input
                    type="number"
                    value={sql`coalesce(metadata_response.number_value::string, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(
                            s,
                            "numberValue",
                            sql`try_cast(target_value as double)`,
                          );
                        },
                      });
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'date'`}>
                  <Input
                    type="date"
                    value={sql`coalesce(metadata_response.date_value::string, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(
                            s,
                            "dateValue",
                            sql`try_cast(target_value as date)`,
                          );
                        },
                      });
                    }}
                  />
                </Show>
                <Show when={sql`metadata_response.type = 'single_choice'`}>
                  <Select
                    className="w-full"
                    value={sql`coalesce(
                      metadata_response.selected_choice_id::string, '')`}
                    onInput={(s) => {
                      s.tryServer({
                        body: (s) => {
                          saveMetadata(
                            s,
                            "selectedChoiceId",
                            sql`case
                              when nullif(target_value, '') is null then null
                              else target_value::bigint
                            end`,
                          );
                          s.refetch();
                        },
                      });
                    }}
                  >
                    <Select.Option value="">Not recorded</Select.Option>
                    <Each
                      table="assessment_metadata_choices"
                      recordName="metadata_choice"
                      where={sql`metadata_choice.field_id =
                        metadata_response.field_id`}
                    >
                      <Select.Option value={sql`metadata_choice.id::string`}>
                        {sql`metadata_choice.label`}
                      </Select.Option>
                    </Each>
                  </Select>
                </Show>
              </Show>
            </FormControl>
          </Each>
        </div>
      </div>
    </Show>
  );
}

function EmployeeTrainingTaskPage(
  props: { block: TrainingBlock; accessToken?: Sql },
) {
  const block = props.block;
  const completionAttestation = trainingCompletionAttestation(block.opts);
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("essay_response", sql.lit``);
        s.defScalar("completion_attestation_confirmed", sql`false`);
        s.defScalar("complete_error", {
          type: { type: "String", maxLength: 1000 },
        });
      }}
    >
      <Data
        queryParams={{
          training_return_source: sql.lit``,
        }}
        procedure={(s) => {
          s.defScalar(
            "person_id",
            props.accessToken
              ? sql`(
                select token_assignment.person_id
                from db.training_access_tokens token
                join db.training_assignments token_assignment
                  on token_assignment.id = token.training_assignment_id
                join db.training_employee_tasks token_task
                  on token_task.training_assignment_id =
                    token.training_assignment_id
                 and token_task.id = ui.training_task_id
                where token.token = ${props.accessToken}
                  and token.revoked_at is null
                  and token.expires_at > now()
                  and ${openTrainingAssignmentWhereSql(sql`token_assignment`)}
                limit 1
              )`
              : currentEmployeeId(block.opts),
          );
          s.defRecord(
            "task",
            sql`select t.*,
                    coalesce(d.title, i.external_title, i.content) as title,
                    coalesce(document_settings.requires_essay, i.requires_essay, false) as requires_essay,
                    coalesce(i.essay_prompt, document_settings.default_essay_prompt) as essay_prompt,
                    coalesce(v.version_label, 'Current course version') as version_label,
                    coalesce(lang.code, assignment_lang.code) as language,
                    coalesce(v.file_name, v.external_url, i.external_url) as file_name,
                    v.content_mode,
                    v.blob_hash,
                    v.rich_content,
                    i.type as course_item_type,
                    coalesce(v.external_url, i.external_url) as external_url,
	                  a.training_course_id is not null as is_course_task,
	                    ${
              personLanguageSql(block.opts, sql`e`)
            } as employee_language,
	                    ${employeeName(block.opts, sql`e`)} as employee_name,
	                    v.id is not null and lang.code != ${
              personLanguageSql(block.opts, sql`e`)
            } as uses_default_language
                from db.training_employee_tasks t
                join db.training_assignments a on a.id = t.training_assignment_id
                join db.${
              sql.ref(personTable(block.opts))
            } e on e.id = a.person_id
                left join db.training_content_languages assignment_lang
                  on assignment_lang.code = a.training_language
                left join db.training_course_section_items i on i.id = t.training_course_section_item_id
                left join db.training_content_versions v on v.id = t.document_version_id
                left join db.training_content_language_variants variant
                  on variant.id = v.document_language_variant_id
                left join db.training_content_documents d on d.id = variant.document_id
                left join db.training_document_settings document_settings
                  on document_settings.document_id = d.id
                left join db.training_content_languages lang
                  on lang.code = variant.language
                where t.id = ui.training_task_id
                  and a.person_id = ui.person_id
                  ${
              props.accessToken
                ? sql`and exists (
                    select 1
                    from db.training_access_tokens token
                    where token.token = ${props.accessToken}
                      and token.revoked_at is null
                      and token.expires_at > now()
                      and token.training_assignment_id = t.training_assignment_id
                      and ${openTrainingAssignmentWhereSql(sql`a`)}
                  )`
                : sql``
            }`,
          );
          // Library documents attached to the course step this task came
          // from, pinned to the version snapshotted on the task.
          s.defTable(
            "task_item_documents",
            sql`select task_doc.id,
                    coalesce(item_doc.label, d.title) as title,
                    v.id as document_version_id,
                    v.file_name, v.content_mode, v.blob_hash,
                    v.rich_content, v.external_url
                from db.training_task_item_documents task_doc
                join db.training_course_section_item_documents item_doc
                  on item_doc.id =
                    task_doc.training_course_section_item_document_id
                join db.training_content_documents d
                  on d.id = item_doc.document_id
                join db.training_content_versions v
                  on v.id = task_doc.document_version_id
                where task_doc.training_employee_task_id = ui.training_task_id
                order by item_doc.sort_order, task_doc.id`,
          );
        }}
      >
        <Show
          when={sql`task.id is not null`}
          fallback={
            <AccessProblemNotice
              block={props.block}
              kind={props.accessToken ? "invite" : "task"}
            />
          }
        >
          <Effect
            watch={[sql`task.id`]}
            triggerOnMount
            onChange={(s) => {
              s.tryServer({
                body: (s) => {
                  s.startTransaction();
                  s.modify(sql`
                  update db.training_employee_tasks
                  set status = case when status = 'assigned' then 'in_progress' else status end
                  where id = task.id
                    and exists (
                      select 1
                      from db.training_assignments task_assignment
                      where task_assignment.id = training_assignment_id
                        and task_assignment.person_id = ui.person_id
                        and task_assignment.status != 'completed'
                        and task_assignment.employee_final_signed_at is null
                    )
                    and status in ('assigned', 'in_progress')
                `);
                  s.commitTransaction();
                  s.refetch();
                },
              });
            }}
          />
          <PageShell
            title={sql`task.title`}
            subtitle={sql`coalesce(${
              relativeDueSql(sql`task.employee_language`, sql`task.due_date`)
            }, '')`}
          >
            <div className="max-w-4xl mx-auto">
              <Show
                when={sql`not (training_return_source = 'dashboard' and task.status = 'completed')`}
              >
                <div className="mb-3">
                  <Button
                    component="a"
                    href={sql`case when task.is_course_task and training_return_source != 'dashboard' then ${
                      employeeCourseHref(
                        props.block,
                        sql`task.training_assignment_id`,
                        props.accessToken,
                      )
                    } else ${
                      employeeHomeHref(props.block, props.accessToken)
                    } end`}
                    variant="plain"
                    color="neutral"
                    size="sm"
                    startIcon="ArrowBack"
                  >
                    {sql`case when task.is_course_task and training_return_source != 'dashboard' then ${
                      employeeText(sql`task.employee_language`, {
                        en: "Back to course",
                        es: "Volver al curso",
                      })
                    } else ${
                      employeeText(sql`task.employee_language`, {
                        en: "Back to My Training",
                        es: "Volver a Mi Capacitación",
                      })
                    } end`}
                  </Button>
                </div>
              </Show>
              <Card variant="outlined">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 w-full">
                    <div>
                      <Typography level="title-lg" startIcon="TaskAlt">
                        {employeeText(sql`task.employee_language`, {
                          en: "Training Sign-Off",
                          es: "Firma de capacitación",
                        })}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {employeeText(sql`task.employee_language`, {
                          en:
                            "Review the assigned material, add any required response, then sign.",
                          es:
                            "Revise el material asignado, agregue la respuesta requerida y luego firme.",
                        })}
                      </Typography>
                      <Show when={sql`task.uses_default_language`}>
                        <Typography level="body-sm" className="text-amber-700">
                          {employeeText(sql`task.employee_language`, {
                            en:
                              "This assignment is using the default-language version because no active translation is published.",
                            es:
                              "Esta asignación usa la versión en idioma predeterminado porque no hay una traducción activa publicada.",
                          })}
                        </Typography>
                      </Show>
                    </div>
                    <div className="self-start shrink-0">
                      <StatusChip
                        fallbackLabel={sql`task.status`}
                        cases={[
                          {
                            when: sql`task.status = 'completed'`,
                            label: employeeText(sql`task.employee_language`, {
                              en: "Completed",
                              es: "Completada",
                            }),
                            color: "success",
                          },
                          {
                            when: sql`task.status != 'completed'
                            and task.due_date is not null
                            and task.due_date < current_date()`,
                            label: employeeText(sql`task.employee_language`, {
                              en: "Overdue",
                              es: "Atrasada",
                            }),
                            color: "danger",
                          },
                          {
                            when: sql`task.status = 'in_progress'
                            and (task.due_date is null
                              or task.due_date >= current_date())`,
                            label: employeeText(sql`task.employee_language`, {
                              en: "In progress",
                              es: "En progreso",
                            }),
                            color: "primary",
                          },
                          {
                            when: sql`task.status = 'assigned'
                            and (task.due_date is null
                              or task.due_date >= current_date())`,
                            label: employeeText(sql`task.employee_language`, {
                              en: "Not started",
                              es: "Sin iniciar",
                            }),
                            color: "neutral",
                          },
                        ]}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 p-3 rounded-md bg-neutral-50 border border-divider flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <Typography level="body-sm" className="text-neutral-700">
                        {employeeText(sql`task.employee_language`, {
                          en:
                            "Review the assigned materials, answer any required prompt, then draw your signature for the active revision.",
                          es:
                            "Revise los materiales asignados, responda cualquier pregunta requerida y dibuje su firma para la revisión activa.",
                        })}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {sql`task.file_name`}
                      </Typography>
                    </div>
                    <Show when={sql`task.external_url is not null`}>
                      <Button
                        component="a"
                        href={sql`case
                          when task.document_version_id is not null then ${
                          trainingExternalVersionUrl(
                            sql`task.document_version_id`,
                            sql`task.id`,
                            props.accessToken,
                          )
                        }
                          else task.external_url
                        end`}
                        target="_blank"
                        variant="outlined"
                        color="neutral"
                        size="sm"
                        startIcon="OpenInNew"
                        className="self-start sm:self-center"
                      >
                        {employeeText(sql`task.employee_language`, {
                          en: "Open assigned link",
                          es: "Abrir enlace asignado",
                        })}
                      </Button>
                    </Show>
                    <Show
                      when={sql`task.document_version_id is not null
                      and task.blob_hash is not null`}
                    >
                      <Button
                        component="a"
                        href={trainingFileVersionUrl(
                          sql`task.document_version_id`,
                          sql`task.id`,
                          props.accessToken,
                        )}
                        target="_blank"
                        variant="outlined"
                        color="neutral"
                        size="sm"
                        startIcon="OpenInNew"
                        className="self-start sm:self-center"
                      >
                        {employeeText(sql`task.employee_language`, {
                          en: "Open primary document",
                          es: "Abrir documento principal",
                        })}
                      </Button>
                    </Show>
                  </div>
                  <Show
                    when={sql`task.document_version_id is not null
                    and task.blob_hash is not null
                    and task.content_mode = 'pdf_attachment'`}
                  >
                    <div className="mb-4 rounded-md border border-divider overflow-hidden bg-white">
                      <iframe
                        src={trainingFileVersionUrl(
                          sql`task.document_version_id`,
                          sql`task.id`,
                          props.accessToken,
                        )}
                        title="Assigned document"
                        className="w-full border-0 block"
                        style={{ height: "65vh" }}
                      />
                    </div>
                  </Show>
                  <Show when={sql`task.rich_content is not null`}>
                    <div className="mb-4 rounded-md border border-divider bg-white p-4">
                      <LexicalRichTextDisplay
                        value={sql`task.rich_content`}
                        imageSrcPrefixRewrite={trainingNativeImageSrcPrefixRewrite(
                          sql`task.document_version_id`,
                          sql`task.id`,
                          props.accessToken,
                        )}
                      />
                    </div>
                  </Show>
                  <Show
                    when={sql`exists (select 1 from task_item_documents)`}
                  >
                    <div className="mb-4">
                      <Typography level="title-sm" className="mb-2">
                        {employeeText(sql`task.employee_language`, {
                          en: "Linked documents",
                          es: "Documentos vinculados",
                        })}
                      </Typography>
                      <div className="flex flex-col gap-2">
                        <Each
                          table="task_item_documents"
                          recordName="linked_doc"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-divider bg-neutral-50 px-3 py-2">
                            <Typography level="title-sm" className="min-w-0">
                              {sql`linked_doc.title`}
                            </Typography>
                            <div className="flex gap-2">
                              <Show
                                when={sql`linked_doc.external_url is not null`}
                              >
                                <Button
                                  component="a"
                                  href={trainingExternalVersionUrl(
                                    sql`linked_doc.document_version_id`,
                                    sql`task.id`,
                                    props.accessToken,
                                  )}
                                  target="_blank"
                                  variant="outlined"
                                  color="neutral"
                                  size="sm"
                                  startIcon="OpenInNew"
                                >
                                  {employeeText(
                                    sql`task.employee_language`,
                                    { en: "Open", es: "Abrir" },
                                  )}
                                </Button>
                              </Show>
                              <Show
                                when={sql`linked_doc.blob_hash is not null`}
                              >
                                <Button
                                  component="a"
                                  href={trainingFileVersionUrl(
                                    sql`linked_doc.document_version_id`,
                                    sql`task.id`,
                                    props.accessToken,
                                  )}
                                  target="_blank"
                                  variant="outlined"
                                  color="neutral"
                                  size="sm"
                                  startIcon="OpenInNew"
                                >
                                  {employeeText(
                                    sql`task.employee_language`,
                                    { en: "Open", es: "Abrir" },
                                  )}
                                </Button>
                              </Show>
                            </div>
                          </div>
                          <Show
                            when={sql`linked_doc.rich_content is not null`}
                          >
                            <div className="rounded-md border border-divider bg-white p-3">
                              <LexicalRichTextDisplay
                                value={sql`linked_doc.rich_content`}
                                imageSrcPrefixRewrite={trainingNativeImageSrcPrefixRewrite(
                                  sql`linked_doc.document_version_id`,
                                  sql`task.id`,
                                  props.accessToken,
                                )}
                              />
                            </div>
                          </Show>
                        </Each>
                      </div>
                    </div>
                  </Show>
                  <Show
                    when={sql`task.status = 'completed'`}
                    fallback={
                      <Show
                        when={sql`task.status = 'waived'`}
                        fallback={
                          <div className="flex flex-col gap-4">
                            <Show when={sql`task.requires_essay`}>
                              <FormControl>
                                <FormLabel>
                                  {sql`coalesce(task.essay_prompt, ${
                                    employeeText(sql`task.employee_language`, {
                                      en:
                                        "Describe what you learned and how you will apply it.",
                                      es:
                                        "Describa lo que aprendió y cómo lo aplicará.",
                                    })
                                  })`}
                                </FormLabel>
                                <Textarea
                                  bindScalar="essay_response"
                                  minRows={6}
                                />
                              </FormControl>
                            </Show>
                            <div className="border-t border-divider pt-4 mt-1">
                              <label className="mb-4 flex items-start gap-3 rounded-md border border-divider bg-neutral-50 p-4">
                                <span className="shrink-0 pt-0.5">
                                  <Checkbox bindScalar="completion_attestation_confirmed" />
                                </span>
                                <span className="text-sm text-neutral-800">
                                  {completionAttestation}
                                </span>
                              </label>
                              <SignaturePad
                                label={employeeText(
                                  sql`task.employee_language`,
                                  {
                                    en: "Draw your signature",
                                    es: "Dibuje su firma",
                                  },
                                )}
                                submitLabel={employeeText(
                                  sql`task.employee_language`,
                                  {
                                    en: "Sign and complete",
                                    es: "Firmar y completar",
                                  },
                                )}
                                submitDisabled={sql`not completion_attestation_confirmed`}
                                onSigned={(s, signatureData) => {
                                  s.setScalar("complete_error", sql`null`);
                                  s.tryServer({
                                    body: (s) => {
                                      s.if(
                                        sql`not ui.completion_attestation_confirmed`,
                                        (s) => {
                                          s.setScalar(
                                            "ui.complete_error",
                                            employeeText(
                                              sql`task.employee_language`,
                                              {
                                                en:
                                                  "Confirm the acknowledgment before signing.",
                                                es:
                                                  "Confirme el reconocimiento antes de firmar.",
                                              },
                                            ),
                                          );
                                          s.return();
                                        },
                                      );
                                      s.if(
                                        sql`task.requires_essay and trim(ui.essay_response) = ''`,
                                        (s) => {
                                          s.setScalar(
                                            "ui.complete_error",
                                            employeeText(
                                              sql`task.employee_language`,
                                              {
                                                en:
                                                  "Essay response is required.",
                                                es:
                                                  "La respuesta escrita es obligatoria.",
                                              },
                                            ),
                                          );
                                          s.return();
                                        },
                                      );
                                      s.startTransaction();
                                      s.callStoredProcedure(
                                        "training_complete_task",
                                        {
                                          inputScalars: {
                                            p_task_id: sql`task.id`,
                                            p_access_token: props.accessToken ??
                                              sql`null`,
                                            p_signature_data: signatureData,
                                            p_completion_attestation: sql.lit(
                                              completionAttestation,
                                            ),
                                            p_essay_response:
                                              sql`ui.essay_response`,
                                          },
                                        },
                                      );
                                      s.commitTransaction();
                                      s.navigate(
                                        sql`case when task.is_course_task then ${
                                          employeeCourseHref(
                                            props.block,
                                            sql`task.training_assignment_id`,
                                            props.accessToken,
                                          )
                                        } else ${
                                          employeeHomeHref(
                                            props.block,
                                            props.accessToken,
                                          )
                                        } end`,
                                      );
                                    },
                                    catch: (s) => {
                                      s.setScalar(
                                        "complete_error",
                                        employeeText(
                                          sql`task.employee_language`,
                                          {
                                            en: "Completion failed",
                                            es: "No se pudo completar",
                                          },
                                        ),
                                      );
                                    },
                                  });
                                }}
                              />
                            </div>
                            <Show when={sql`complete_error is not null`}>
                              <Alert color="danger" startIcon="Error">
                                {sql`complete_error`}
                              </Alert>
                            </Show>
                          </div>
                        }
                      >
                        <div className="flex flex-col gap-3">
                          <Alert color="neutral" startIcon="Block">
                            {sql`case
                              when task.waiver_reason is null then ${
                              employeeText(sql`task.employee_language`, {
                                en:
                                  "This training item was replaced by a newer revision.",
                                es:
                                  "Este elemento de capacitación fue reemplazado por una revisión más reciente.",
                              })
                            }
                              else ${
                              employeeText(sql`task.employee_language`, {
                                en: "This training requirement was waived.",
                                es:
                                  "Este requisito de capacitación fue eximido.",
                              })
                            }
                            end`}
                          </Alert>
                          <Show when={sql`task.waiver_reason is not null`}>
                            <div className="rounded-md border border-divider bg-neutral-50 p-3">
                              <Typography level="title-sm">
                                {employeeText(sql`task.employee_language`, {
                                  en: "Waiver record",
                                  es: "Registro de exención",
                                })}
                              </Typography>
                              <Typography
                                level="body-sm"
                                className="mt-1 text-neutral-600"
                              >
                                {formatDateTimeSql(sql`task.waived_at`)}
                              </Typography>
                              <Typography level="body-sm" className="mt-2">
                                {sql`task.waiver_reason`}
                              </Typography>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    }
                  >
                    <div className="flex flex-col gap-4">
                      <Alert color="success" startIcon="CheckCircle">
                        {employeeText(sql`task.employee_language`, {
                          en: "This training item is complete.",
                          es: "Esta capacitación está completa.",
                        })}
                      </Alert>
                      <div className="rounded-md border border-divider bg-neutral-50 p-3">
                        <Typography level="title-sm" startIcon="Draw">
                          {employeeText(sql`task.employee_language`, {
                            en: "Signed record",
                            es: "Registro firmado",
                          })}
                        </Typography>
                        <Typography
                          level="body-sm"
                          className="text-neutral-700 mt-1"
                        >
                          {sql`task.signature_name || ' · ' || ${
                            formatDateTimeSql(sql`task.completed_at`)
                          } || ' · ' || task.version_label ||
	                          coalesce(' · ' || upper(task.language), '')`}
                        </Typography>
                        <Typography
                          level="body-sm"
                          className="mt-2 text-neutral-700"
                        >
                          {sql`task.completion_attestation`}
                        </Typography>
                        <Show when={sql`task.signature_data is not null`}>
                          <img
                            src={sql`task.signature_data`}
                            alt="Employee signature"
                            className="mt-3 max-h-24 w-fit rounded border border-divider bg-white p-2"
                          />
                        </Show>
                      </div>
                      <Show when={sql`task.essay_response is not null`}>
                        <div className="rounded-md border border-divider bg-white p-3">
                          <Typography level="title-sm">
                            {sql`coalesce(task.essay_prompt, ${
                              employeeText(sql`task.employee_language`, {
                                en: "Written response",
                                es: "Respuesta escrita",
                              })
                            })`}
                          </Typography>
                          <Typography
                            level="body-sm"
                            className="text-neutral-700 mt-1"
                          >
                            {sql`task.essay_response`}
                          </Typography>
                        </div>
                      </Show>
                      <Button
                        component="a"
                        href={sql`case when task.is_course_task and training_return_source != 'dashboard' then ${
                          employeeCourseHref(
                            props.block,
                            sql`task.training_assignment_id`,
                            props.accessToken,
                          )
                        } else ${
                          employeeHomeHref(props.block, props.accessToken)
                        } end`}
                        variant="outlined"
                        color="neutral"
                        startIcon="ArrowBack"
                        className="self-start"
                      >
                        {sql`case when task.is_course_task and training_return_source != 'dashboard' then ${
                          employeeText(sql`task.employee_language`, {
                            en: "Back to course",
                            es: "Volver al curso",
                          })
                        } else ${
                          employeeText(sql`task.employee_language`, {
                            en: "Back to My Training",
                            es: "Volver a Mi Capacitación",
                          })
                        } end`}
                      </Button>
                    </div>
                  </Show>
                </CardContent>
              </Card>
            </div>
          </PageShell>
        </Show>
      </Data>
    </Data>
  );
}

export function EmployeePersonnelFilePage(
  props: {
    block: TrainingBlock;
    courseValidationHref?: (employeeId: Sql, assignmentId: Sql) => Sql;
  },
) {
  const block = props.block;
  const includeCompliance = trainingFeatureEnabled(block.opts, "compliance");
  const complianceLabels = trainingComplianceLabels;
  const validationLabels = trainingValidationLabels(block.opts);
  return (
    <Data
      procedure={(s) => {
        s.defScalar("add_retraining_open", sql`false`);
        s.defScalar("add_competency_open", sql`false`);
        s.defScalar("add_personnel_note_open", sql`false`);
        s.defScalar(
          "can_validate_training",
          currentUserHasPermission(
            sql.lit(trainingPermissions.validateTraining),
          ),
        );
        s.defScalar(
          "can_assign_training",
          currentUserHasPermission(
            sql.lit(trainingPermissions.assignTraining),
          ),
        );
        s.defScalar(
          "can_manage_employee_files",
          currentUserHasPermission(
            sql.lit(trainingPermissions.manageEmployeeFiles),
          ),
        );
        s.defRecord(
          "employee",
          sql`select e.id, ${employeeName(block.opts, sql`e`)} as name,
                    ${personLanguageSql(block.opts, sql`e`)} as language,
                    person_status.open_task_count as open_tasks,
                    person_status.completed_assignment_count
                      as completion_count,
                    person_status.pending_validation_count
                      as pending_validation_count,
                    ${
            includeCompliance
              ? sql`(select count(*) from db.training_retraining_cases r where r.person_id = e.id and r.status = 'open')`
              : sql`0`
          } as open_retraining,
                    ${
            includeCompliance
              ? sql`(select count(*) from db.training_certifications c where c.person_id = e.id)`
              : sql`0`
          } as certification_count,
                    ${
            includeCompliance
              ? sql`(select count(*) from db.training_competency_checks cc where cc.person_id = e.id and ${
                competencyAlertWhereSql(block.opts, sql`cc`)
              })`
              : sql`0`
          } as competency_alerts,
                    ${
            includeCompliance ? sql`person_status.cert_alert_count` : sql`0`
          } as cert_alerts,
                    ${
            includeCompliance
              ? sql`(select count(*) from db.training_personnel_documents p where p.person_id = e.id)`
              : sql`0`
          } as personnel_note_count,
                    person_status.last_completion_at as last_completion_at
              from db.${sql.ref(personTable(block.opts))} e
              join db.training_person_training_status person_status
                on person_status.person_id = e.id
              where e.id = ui.person_id`,
        );
        s.defTable(
          "completed_tasks",
          sql`select t.id, t.completed_at,
                  coalesce(d.title, item.external_title, item.content) as title,
                  v.version_label,
                  lang.code as language, t.signature_name, t.essay_response,
                  t.training_assignment_id
              from db.training_employee_tasks t
              left join db.training_course_section_items item
                on item.id = t.training_course_section_item_id
              join db.training_assignments task_assignment
                on task_assignment.id = t.training_assignment_id
              left join db.training_content_versions v on v.id = t.document_version_id
              left join db.training_content_language_variants variant
                on variant.id = v.document_language_variant_id
              left join db.training_content_documents d on d.id = variant.document_id
              left join db.training_content_languages lang on lang.code = t.training_language
              where task_assignment.person_id = ui.person_id
                and t.status = 'completed'
                and t.document_version_id is not null
              order by t.completed_at desc`,
        );
        s.defTable(
          "completed_course_assignments",
          sql`select a.id,
                     a.status,
                     course.name as title,
                     lang.code as language,
                     a.final_primary_validator_id,
                     a.final_secondary_validator_id,
                     (
                       select max(t.completed_at)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                     ) as completed_at,
                     (
                       select count(*)
                       from db.training_employee_tasks t
                       where t.training_assignment_id = a.id
                         and t.status != 'waived'
                     ) as total_tasks,
                     exists (
                       select 1
                       from db.training_assignment_validations av
                          where av.training_assignment_id = a.id
                         and av.validation_stage_code = ${
            sql.lit(validationLabels.primaryStageCode)
          }
                     ) as primary_validator_validated,
                     exists (
                       select 1
                       from db.training_assignment_validations av
                          where av.training_assignment_id = a.id
                         and av.validation_stage_code = ${
            sql.lit(validationLabels.secondaryStageCode)
          }
                     ) as secondary_validator_validated
              from db.training_assignments a
              join db.training_courses course on course.id = a.training_course_id
              left join db.training_content_languages lang
                on lang.code = a.training_language
              where a.person_id = ui.person_id
                and a.status in ('completed', 'validation_pending')
                and exists (
                  select 1
                  from db.training_assignment_validation_state validation_state
                  where validation_state.assignment_id = a.id
                )
                and not exists (
                  select 1
                  from db.training_employee_tasks open_task
                  where open_task.training_assignment_id = a.id
                    and open_task.status in ('assigned', 'in_progress')
                )
              order by completed_at desc nulls last, a.id desc`,
        );
        s.defScalar("invite_copied_assignment_id", { type: "BigInt" });
        s.defTable(
          "open_assignments",
          sql`select a.id, a.status, a.due_date, a.assigned_at,
                  coalesce(c.name, d.title, 'Training assignment') as training_name,
                  (select count(*)
                   from db.training_employee_tasks t
                   where t.training_assignment_id = a.id
                     and t.status in ('assigned', 'in_progress')) as open_tasks,
                  ${
            assignmentInviteLinkSql(block.opts, sql`a.id`)
          } as invite_link
              from db.training_assignments a
              left join db.training_courses c on c.id = a.training_course_id
              left join db.training_content_documents d on d.id = a.document_id
              where a.person_id = ui.person_id
                and a.status in ('pending', 'in_progress', 'validation_pending')
              order by a.assigned_at desc, a.id desc`,
        );
        if (includeCompliance) {
          s.defTable(
            "cases",
            sql`select r.id, r.status, source.name as source_type, r.reason, r.training_course_id, r.due_date, r.created_at, r.completed_at,
                    r.training_assignment_id is not null as has_assignment
                from db.training_retraining_cases r
                join db.training_retraining_sources source on source.code = r.training_retraining_source
                where r.person_id = ui.person_id
                order by case when r.status = 'open' then 0 else 1 end,
                         r.created_at desc`,
          );
          s.defTable(
            "certs",
            sql`select c.id, c.name, c.certification_number, c.issued_at, c.expires_at,
                    c.source, c.approval_status, c.access_token,
                    c.training_assignment_id is not null as is_generated,
                    c.proof_file_name, c.proof_blob_hash,
                    c.proof_blob_hash is not null as has_proof,
                    exists (
                      select 1
                      from db.training_certifications renewal
                      where renewal.renewed_from_certification_id = c.id
                        and renewal.approval_status = 'approved'
                    ) as superseded,
                    case
                      when exists (
                        select 1
                        from db.training_certifications renewal
                        where renewal.renewed_from_certification_id = c.id
                          and renewal.approval_status = 'approved'
                      ) then 'Superseded'
                      when c.expires_at is null then 'No expiration'
                      when c.expires_at < current_date() then 'Expired'
                      when c.expires_at <= date.add(day, ${certificationWarningDaysSql()}, current_date()) then 'Expiring soon'
                      else 'Current'
                    end as expiration_status
                from db.training_certifications c
                where c.person_id = ui.person_id
                order by superseded, c.expires_at nulls last, c.name`,
          );
          s.defTable(
            "competency_checks",
            sql`select cc.id, cc.title, cc.result, cc.observed_at, cc.notes,
                      cc.recheck_due_date,
                      cc.evidence_file_name, cc.evidence_blob_hash,
                      cc.evidence_blob_hash is not null as has_evidence,
                      ${
              competencyAlertWhereSql(block.opts, sql`cc`)
            } as needs_attention,
                      ${employeeName(block.opts, sql`observer`)} as observed_by
                from db.training_competency_checks cc
                left join db.${
              sql.ref(personTable(block.opts))
            } observer on observer.id = cc.observed_by_id
                where cc.person_id = ui.person_id
                order by cc.observed_at desc nulls last, cc.created_at desc`,
          );
          s.defTable(
            "personnel_docs",
            sql`select p.id, doc_type.name as kind, p.title, p.notes, p.created_at, p.file_name, p.blob_hash, p.blob_hash is not null as has_file
                from db.training_personnel_documents p
                join db.training_personnel_document_types doc_type on doc_type.code = p.training_personnel_document_type
                where p.person_id = ui.person_id
                order by p.created_at desc`,
          );
        }
      }}
    >
      <PageShell
        title={sql`employee.name`}
        subtitle={includeCompliance
          ? "Training record, retraining cases, and compliance evidence."
          : "Training record, signed policies, check sheets, and essays."}
      >
        <Card variant="outlined">
          <CardContent>
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-md bg-primary-50 text-primary-700 flex items-center justify-center">
                  <MaterialIcon icon="Person" className="text-3xl" />
                </div>
                <div>
                  <Typography level="h4">{sql`employee.name`}</Typography>
                  <Typography level="body-sm" className="text-neutral-600">
                    Last validated:{" "}
                    {sql`coalesce(${
                      formatDateSql(sql`employee.last_completion_at`)
                    }, 'None yet')`}
                  </Typography>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" variant="soft" color="warning">
                  {sql`employee.open_tasks`} open training
                </Chip>
                <Chip size="sm" variant="soft" color="primary">
                  {sql`employee.pending_validation_count`} pending validation
                </Chip>
                {includeCompliance && (
                  <>
                    <Chip size="sm" variant="soft" color="warning">
                      {sql`employee.open_retraining`} retraining
                    </Chip>
                    <Chip size="sm" variant="soft" color="danger">
                      {sql`employee.cert_alerts`} cert alerts
                    </Chip>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div
          className={`grid grid-cols-2 ${
            includeCompliance ? "lg:grid-cols-5" : "lg:grid-cols-3"
          } gap-3`}
        >
          <StatTile
            label="Completed training"
            value={sql`employee.completion_count`}
            icon="Verified"
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatTile
            label="Pending validation"
            value={sql`employee.pending_validation_count`}
            icon="Rule"
            tone="bg-sky-50 text-sky-700"
          />
          <StatTile
            label="Open training"
            value={sql`employee.open_tasks`}
            icon="Assignment"
            tone="bg-amber-50 text-amber-800"
          />
          {includeCompliance && (
            <>
              <StatTile
                label="Certifications"
                value={sql`employee.certification_count`}
                icon="Badge"
                tone="bg-sky-50 text-sky-700"
              />
              <StatTile
                label="Competency alerts"
                value={sql`employee.competency_alerts`}
                icon="FactCheck"
                tone="bg-teal-50 text-teal-700"
              />
            </>
          )}
        </div>

        {includeCompliance && (
          <Show when={sql`can_manage_employee_files`}>
            <Card variant="outlined">
              <CardHeader>
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 w-full">
                  <div>
                    <Typography level="title-lg" startIcon="ManageAccounts">
                      Personnel Actions
                    </Typography>
                    <Typography
                      level="body-sm"
                      className="text-neutral-600 mt-1"
                    >
                      Add compliance evidence or follow-up records when
                      something changes for this employee.
                    </Typography>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      startIcon="AddTask"
                      onClick={(s) =>
                        s.setScalar("add_retraining_open", sql`true`)}
                    >
                      Add retraining case
                    </Button>
                    <Button
                      variant="outlined"
                      color="neutral"
                      startIcon="FactCheck"
                      onClick={(s) =>
                        s.setScalar("add_competency_open", sql`true`)}
                    >
                      Add competency check
                    </Button>
                    <Button
                      variant="outlined"
                      color="neutral"
                      startIcon="NoteAdd"
                      onClick={(s) =>
                        s.setScalar("add_personnel_note_open", sql`true`)}
                    >
                      Add personnel note
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Show>
        )}

        {includeCompliance && (
          <Show when={sql`can_manage_employee_files`}>
            <ModalDialog bindScalar="add_retraining_open" maxWidth="lg">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <Typography level="title-lg" startIcon="HistoryEdu">
                    Add Retraining Case
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600 mt-1">
                    Record why retraining is needed and optionally connect it to
                    a training checklist.
                  </Typography>
                </div>
                <IconButton
                  icon="Close"
                  aria-label="Close"
                  variant="plain"
                  color="neutral"
                  onClick={(s) =>
                    s.setScalar("add_retraining_open", sql`false`)}
                />
              </div>
              <Form
                defaultFieldComponent={FieldFormControl}
                beforeTransactionStart={(s) =>
                  block.assertCanManageEmployeeFiles(s)}
                afterTransactionCommit={(s) => s.refetch()}
                afterSubmitClientSuccess={(s, ctx) => {
                  ctx.reset(s);
                  s.setScalar("add_retraining_open", sql`false`);
                }}
              >
                <Form.Insert
                  table="training_retraining_cases"
                  values={{
                    person_id: sql`employee.id`,
                    created_by_id: currentEmployeeId(block.opts),
                    training_retraining_source: retrainingSourceSql(
                      block.opts,
                      sql.lit`manual`,
                    ),
                  }}
                >
                  <div className="grid gap-3">
                    <FormFieldWithLabel
                      field="reason"
                      label="Reason"
                      minRows={3}
                      placeholder="Observed issue, failed check, or supervisor request"
                    />
                    <FormFieldWithLabel
                      field="training_course_id"
                      label="Training checklist"
                    />
                    <FormFieldWithLabel field="due_date" label="Due date" />
                    <Form.SubmitButton startIcon="AddTask">
                      Add retraining
                    </Form.SubmitButton>
                    <Form.ErrorAlert />
                  </div>
                </Form.Insert>
              </Form>
            </ModalDialog>

            <ModalDialog bindScalar="add_competency_open" maxWidth="lg">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <Typography level="title-lg" startIcon="FactCheck">
                    Add Competency Check
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600 mt-1">
                    Record a supervisor-observed practical pass/fail check.
                  </Typography>
                </div>
                <IconButton
                  icon="Close"
                  aria-label="Close"
                  variant="plain"
                  color="neutral"
                  onClick={(s) =>
                    s.setScalar("add_competency_open", sql`false`)}
                />
              </div>
              <Form
                defaultFieldComponent={FieldFormControl}
                beforeTransactionStart={(s) =>
                  block.assertCanManageEmployeeFiles(s)}
                beforeTransactionCommit={(s) => {
                  // A failed check opens a retraining case so the follow-up
                  // is tracked instead of relying on a second manual entry.
                  s.defScalar(
                    "new_competency_check_id",
                    sql`last_record_id(db.training_competency_checks)`,
                  );
                  s.modify(sql`
                    insert into db.training_retraining_cases
                      (person_id, training_retraining_source, source_id,
                       reason, created_by_id)
                    select cc.person_id,
                           ${
                    retrainingSourceWithFallbackSql(block.opts, "competency")
                  },
                           cc.id,
                           'Failed competency check: ' || cc.title,
                           ${currentEmployeeId(block.opts)}
                    from db.training_competency_checks cc
                    where cc.id = new_competency_check_id
                      and cc.result in ('fail', 'needs_retrain')
                  `);
                }}
                afterTransactionCommit={(s) => s.refetch()}
                afterSubmitClientSuccess={(s, ctx) => {
                  ctx.reset(s);
                  s.setScalar("add_competency_open", sql`false`);
                }}
              >
                <Form.Insert
                  table="training_competency_checks"
                  values={{
                    person_id: sql`employee.id`,
                    observed_by_id: currentEmployeeId(block.opts),
                    observed_at: sql`now()`,
                  }}
                >
                  <div className="grid gap-3">
                    <FormFieldWithLabel
                      field="title"
                      label="Check"
                      placeholder={complianceLabels.competencyPlaceholder}
                    />
                    <FormControl>
                      <FormLabel>Related document</FormLabel>
                      <Form.Field field="document_id">
                        {(helper) => (
                          <TrainingDocumentFormControl helper={helper} />
                        )}
                      </Form.Field>
                    </FormControl>
                    <FormFieldWithLabel
                      field="training_certification_id"
                      label="Related certification"
                    />
                    <FormFieldWithLabel field="result" label="Result" />
                    <FormFieldWithLabel
                      field="recheck_due_date"
                      label="Recheck due"
                    />
                    <FormFieldWithLabel
                      field="notes"
                      label="Notes"
                      minRows={3}
                    />
                    <Form.SubmitButton startIcon="FactCheck">
                      Add check
                    </Form.SubmitButton>
                    <Form.ErrorAlert />
                  </div>
                </Form.Insert>
              </Form>
            </ModalDialog>

            <ModalDialog bindScalar="add_personnel_note_open" maxWidth="lg">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <Typography level="title-lg" startIcon="FolderShared">
                    Add Personnel Note
                  </Typography>
                  <Typography level="body-sm" className="text-neutral-600 mt-1">
                    {complianceLabels.personnelCreateHelpText}
                  </Typography>
                </div>
                <IconButton
                  icon="Close"
                  aria-label="Close"
                  variant="plain"
                  color="neutral"
                  onClick={(s) =>
                    s.setScalar("add_personnel_note_open", sql`false`)}
                />
              </div>
              <Form
                defaultFieldComponent={FieldFormControl}
                beforeTransactionStart={(s) =>
                  block.assertCanManageEmployeeFiles(s)}
                afterTransactionCommit={(s) => s.refetch()}
                afterSubmitClientSuccess={(s, ctx) => {
                  ctx.reset(s);
                  s.setScalar("add_personnel_note_open", sql`false`);
                }}
              >
                <Form.Insert
                  table="training_personnel_documents"
                  values={{
                    person_id: sql`employee.id`,
                    created_by_id: currentEmployeeId(block.opts),
                    training_personnel_document_type:
                      personnelDocumentTypeWithFallbackSql(
                        block.opts,
                        "other",
                      ),
                  }}
                >
                  <div className="grid gap-3">
                    <FormFieldWithLabel
                      field="training_personnel_document_type"
                      label="Type"
                    />
                    <FormFieldWithLabel
                      field="title"
                      label="Title"
                      placeholder="Retraining note"
                    />
                    <FormFieldWithLabel
                      field="notes"
                      label="Notes"
                      minRows={3}
                    />
                    <Form.SubmitButton startIcon="NoteAdd">
                      Add note
                    </Form.SubmitButton>
                    <Form.ErrorAlert />
                  </div>
                </Form.Insert>
              </Form>
            </ModalDialog>
          </Show>
        )}

        <div className="flex flex-col gap-5">
          <Card variant="outlined">
            <CardHeader>
              <div>
                <Typography level="title-lg" startIcon="Assignment">
                  Open Assignments
                </Typography>
                <Typography level="body-sm" className="text-neutral-600 mt-1">
                  Training in progress for this person. The invite link opens
                  the assignment without a portal login — share it with
                  contractors or anyone who cannot sign in.
                </Typography>
              </div>
            </CardHeader>
            <CardContent>
              <Show when={sql`not exists (select 1 from open_assignments)`}>
                <EmptyState
                  icon="AssignmentTurnedIn"
                  title="No open assignments"
                  body="Assign a document or course and it will appear here with its invite link."
                />
              </Show>
              <div className="grid gap-3">
                <Each table="open_assignments" recordName="open_assignment">
                  <div className="p-4 border border-divider rounded-md bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="min-w-0">
                      <Typography level="title-md">
                        {sql`open_assignment.training_name`}
                      </Typography>
                      <Typography level="body-sm" className="text-neutral-600">
                        {sql`open_assignment.open_tasks::string ||
                          case when open_assignment.open_tasks = 1
                            then ' open task' else ' open tasks' end ||
                          coalesce(' · Due ' || ${
                          formatDateSql(sql`open_assignment.due_date`)
                        }, '') ||
                          ' · Assigned ' || ${
                          formatDateSql(sql`open_assignment.assigned_at`)
                        }`}
                      </Typography>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <StatusChip
                        fallbackLabel={sql`open_assignment.status`}
                        cases={[
                          {
                            when: sql`open_assignment.status = 'pending'`,
                            label: "Not started",
                            color: "neutral",
                          },
                          {
                            when: sql`open_assignment.status = 'in_progress'`,
                            label: "In progress",
                            color: "primary",
                          },
                          {
                            when:
                              sql`open_assignment.status = 'validation_pending'`,
                            label: "Awaiting validation",
                            color: "warning",
                          },
                        ]}
                      />
                      <Show when={sql`open_assignment.invite_link is not null`}>
                        <Button
                          size="sm"
                          variant="outlined"
                          color="neutral"
                          startIcon="Link"
                          onClick={(s) => {
                            s.clipboard.writeText(
                              sql`open_assignment.invite_link`,
                            );
                            s.setScalar(
                              "invite_copied_assignment_id",
                              sql`open_assignment.id`,
                            );
                          }}
                        >
                          Copy invite link
                        </Button>
                        <Show
                          when={sql`invite_copied_assignment_id = open_assignment.id`}
                        >
                          <Chip size="sm" variant="soft" color="success">
                            Copied
                          </Chip>
                        </Show>
                      </Show>
                    </div>
                  </div>
                </Each>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-5">
            <Card variant="outlined">
              <CardHeader>
                <Typography level="title-lg" startIcon="Rule">
                  Course Validations
                </Typography>
              </CardHeader>
              <CardContent>
                <Show
                  when={sql`not exists (select 1 from completed_course_assignments)`}
                >
                  <EmptyState
                    icon="Rule"
                    title="No completed courses to validate"
                    body="Completed course validations will appear here after a course is finished."
                  />
                </Show>
                <div className="grid gap-3">
                  <Each
                    table="completed_course_assignments"
                    recordName="completed_assignment"
                  >
                    <div className="p-4 border border-divider rounded-md bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="min-w-0">
                        <Typography level="title-md">
                          {sql`completed_assignment.title`}
                        </Typography>
                        <Typography
                          level="body-sm"
                          className="text-neutral-600"
                        >
                          {sql`upper(completed_assignment.language) || ' · Completed ' || ${
                            formatDateSql(
                              sql`completed_assignment.completed_at`,
                            )
                          } || ' · ' || completed_assignment.total_tasks::string ||
                            case when completed_assignment.total_tasks = 1 then ' task' else ' tasks' end`}
                        </Typography>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <StatusChip
                          fallbackLabel={sql`completed_assignment.status`}
                          cases={[
                            {
                              when:
                                sql`(completed_assignment.final_primary_validator_id is not null
                                    and not completed_assignment.primary_validator_validated)
                                  or (completed_assignment.final_secondary_validator_id is not null
                                    and not completed_assignment.secondary_validator_validated)`,
                              label: "Pending validation",
                              color: "warning",
                            },
                          ]}
                        />
                        <Button
                          component="a"
                          href={props.courseValidationHref
                            ? props.courseValidationHref(
                              sql`employee.id`,
                              sql`completed_assignment.id`,
                            )
                            : employeeCourseHref(
                              props.block,
                              sql`completed_assignment.id`,
                            )}
                          variant="outlined"
                          color="neutral"
                          size="sm"
                          startIcon="OpenInNew"
                        >
                          Open course
                        </Button>
                      </div>
                    </div>
                  </Each>
                </div>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardHeader>
                <Typography level="title-lg" startIcon="Verified">
                  Completion Evidence
                </Typography>
              </CardHeader>
              <CardContent>
                <Show when={sql`not exists (select 1 from completed_tasks)`}>
                  <EmptyState
                    icon="AssignmentTurnedIn"
                    title="No completed signoffs"
                    body="Signed document completions and written responses will appear here."
                  />
                </Show>
                <div className="grid gap-3">
                  <Each table="completed_tasks" recordName="completed_task">
                    <div className="p-4 border border-divider rounded-md bg-white">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                        <div>
                          <Typography level="title-md">
                            {sql`completed_task.title`}
                          </Typography>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600"
                          >
                            {sql`completed_task.version_label`} ·{" "}
                            {sql`upper(completed_task.language)`}
                          </Typography>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Chip size="sm" variant="soft" color="success">
                            {formatDateTimeSql(
                              sql`completed_task.completed_at`,
                            )}
                          </Chip>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 rounded-md bg-neutral-50 border border-divider">
                          <Typography
                            level="body-sm"
                            className="text-neutral-600"
                          >
                            Signature
                          </Typography>
                          <Typography level="title-sm">
                            {sql`completed_task.signature_name`}
                          </Typography>
                        </div>
                        <Show
                          when={sql`completed_task.essay_response is not null`}
                        >
                          <div className="p-3 rounded-md bg-neutral-50 border border-divider">
                            <Typography
                              level="body-sm"
                              className="text-neutral-600"
                            >
                              Written response
                            </Typography>
                            <Typography level="body-sm">
                              {sql`completed_task.essay_response`}
                            </Typography>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </Each>
                </div>
              </CardContent>
            </Card>

            {includeCompliance && (
              <Card variant="outlined">
                <CardHeader>
                  <Typography level="title-lg" startIcon="HistoryEdu">
                    Retraining Cases
                  </Typography>
                </CardHeader>
                <CardContent>
                  <Show when={sql`not exists (select 1 from cases)`}>
                    <EmptyState
                      icon="TaskAlt"
                      title="No retraining cases"
                      body="Supervisor-created or quality-triggered retraining cases will appear here."
                    />
                  </Show>
                  <div className="grid gap-3">
                    <Each table="cases" recordName="case_record">
                      <div className="p-4 border border-divider rounded-md bg-white">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                          <div>
                            <Typography level="title-md">
                              {sql`case_record.reason`}
                            </Typography>
                            <Typography
                              level="body-sm"
                              className="text-neutral-600"
                            >
                              Source: {sql`case_record.source_type`} · Created
                              {" "}
                              {formatDateTimeSql(sql`case_record.created_at`)}
                            </Typography>
                          </div>
                          <StatusChip
                            fallbackLabel={sql`case_record.status`}
                            cases={[
                              {
                                when: sql`case_record.status = 'open'`,
                                label: "Open",
                                color: "warning",
                              },
                              {
                                when: sql`case_record.status = 'completed'`,
                                label: "Complete",
                                color: "success",
                              },
                              {
                                when: sql`case_record.status = 'cancelled'`,
                                label: "Cancelled",
                                color: "neutral",
                              },
                            ]}
                          />
                        </div>
                        <Show when={sql`case_record.due_date is not null`}>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600 mt-3"
                          >
                            Due {formatDateSql(sql`case_record.due_date`)}
                          </Typography>
                        </Show>
                        <Show when={sql`case_record.completed_at is not null`}>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600 mt-3"
                          >
                            Completed{" "}
                            {formatDateTimeSql(sql`case_record.completed_at`)}
                          </Typography>
                        </Show>
                        <Show
                          when={sql`
                            case_record.status = 'open'
                            and case_record.training_course_id is not null
                            and not case_record.has_assignment
                            and can_assign_training
                          `}
                        >
                          <Button
                            size="sm"
                            startIcon="AssignmentInd"
                            className="mt-3"
                            onClick={(s) => {
                              s.tryServer({
                                body: (s) => {
                                  block.assertCanAssignTraining(s);
                                  s.startTransaction();
                                  s.callStoredProcedure(
                                    "training_assign_course",
                                    {
                                      inputScalars: {
                                        p_person_id: sql`employee.id`,
                                        p_course_id:
                                          sql`case_record.training_course_id`,
                                        p_language: sql`null`,
                                        p_due_date: sql`case_record.due_date`,
                                        p_reason: sql`case_record.reason`,
                                        p_source: sql`null`,
                                        p_notify: sql`true`,
                                      },
                                      outputScalars: {
                                        assigned_training_assignment_id:
                                          "retraining_assignment_id",
                                      },
                                    },
                                  );
                                  s.modify(sql`
                                  update db.training_retraining_cases
                                  set training_assignment_id =
                                    retraining_assignment_id
                                  where id = case_record.id
                                `);
                                  s.commitTransaction();
                                  s.refetch();
                                },
                              });
                            }}
                          >
                            Assign linked checklist
                          </Button>
                        </Show>
                        <Show
                          when={sql`case_record.status = 'open'
                            and can_manage_employee_files`}
                        >
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outlined"
                              color="success"
                              startIcon="TaskAlt"
                              onClick={(s) => {
                                s.tryServer({
                                  body: (s) => {
                                    block.assertCanManageEmployeeFiles(s);
                                    s.startTransaction();
                                    s.modify(sql`
                                    update db.training_retraining_cases
                                    set status = 'completed',
                                        completed_at = now()
                                    where id = case_record.id
                                      and status = 'open'
                                  `);
                                    s.commitTransaction();
                                    s.refetch();
                                  },
                                });
                              }}
                            >
                              Mark complete
                            </Button>
                            <Button
                              size="sm"
                              variant="plain"
                              color="neutral"
                              startIcon="Cancel"
                              onClick={(s) => {
                                s.tryServer({
                                  body: (s) => {
                                    block.assertCanManageEmployeeFiles(s);
                                    s.startTransaction();
                                    s.modify(sql`
                                    update db.training_retraining_cases
                                    set status = 'cancelled'
                                    where id = case_record.id
                                      and status = 'open'
                                  `);
                                    s.commitTransaction();
                                    s.refetch();
                                  },
                                });
                              }}
                            >
                              Cancel case
                            </Button>
                          </div>
                        </Show>
                      </div>
                    </Each>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {includeCompliance && (
            <Card variant="outlined">
              <CardHeader>
                <Typography level="title-lg" startIcon="FactCheck">
                  Practical Competency Checks
                </Typography>
              </CardHeader>
              <CardContent>
                <Show when={sql`not exists (select 1 from competency_checks)`}>
                  <EmptyState
                    icon="FactCheck"
                    title="No competency checks"
                    body="Supervisor-observed practical checks will appear here."
                  />
                </Show>
                <div className="grid gap-3">
                  <Each table="competency_checks" recordName="check">
                    <div className="p-4 border border-divider rounded-md bg-white">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Typography level="title-md">
                            {sql`check.title`}
                          </Typography>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600"
                          >
                            Observed by{" "}
                            {sql`coalesce(check.observed_by, 'Not recorded')`} ·
                            {" "}
                            {sql`coalesce(${
                              formatDateTimeSql(sql`check.observed_at`)
                            }, 'No date')`}
                          </Typography>
                        </div>
                        <StatusChip
                          fallbackLabel={sql`check.result`}
                          cases={[
                            {
                              when: sql`check.result = 'pass'`,
                              label: "Pass",
                              color: "success",
                            },
                            {
                              when: sql`check.result = 'pending'`,
                              label: "Pending",
                              color: "warning",
                            },
                            {
                              when: sql`check.result = 'fail'`,
                              label: "Fail",
                              color: "danger",
                            },
                            {
                              when: sql`check.result = 'needs_retrain'`,
                              label: "Needs retraining",
                              color: "danger",
                            },
                          ]}
                        />
                      </div>
                      <Show
                        when={sql`check.recheck_due_date is not null
                          and check.result = 'pass' and check.needs_attention`}
                      >
                        <Typography
                          level="body-sm"
                          className="text-amber-700 font-medium mt-3"
                        >
                          Recheck due{" "}
                          {formatDateSql(sql`check.recheck_due_date`)}
                        </Typography>
                      </Show>
                      <Show
                        when={sql`check.recheck_due_date is not null
                          and not (check.result = 'pass' and check.needs_attention)`}
                      >
                        <Typography
                          level="body-sm"
                          className="text-neutral-600 mt-3"
                        >
                          Recheck due{" "}
                          {formatDateSql(sql`check.recheck_due_date`)}
                        </Typography>
                      </Show>
                      <Show when={sql`check.notes is not null`}>
                        <Typography
                          level="body-sm"
                          className="text-neutral-700 mt-3"
                        >
                          {sql`check.notes`}
                        </Typography>
                      </Show>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Show when={sql`can_manage_employee_files`}>
                          <Button
                            component="label"
                            size="sm"
                            variant="outlined"
                            color="neutral"
                            startIcon="UploadFile"
                          >
                            <input
                              type="file"
                              sx={visuallyHiddenStyles}
                              onFileChange={(s) => {
                                s.defRecord(
                                  "dom_file",
                                  sql`select * from file limit 1`,
                                );
                                s.tryServer({
                                  transferFiles: sql`select uuid from file`,
                                  body: (s) => {
                                    block.assertCanManageEmployeeFiles(s);
                                    s.readDomFile(
                                      sql`dom_file.uuid`,
                                      "content",
                                    );
                                    s.createBlob(
                                      sql`content`,
                                      "competency_evidence_blob_hash",
                                    );
                                    s.startTransaction();
                                    s.modify(sql`
                                  update db.training_competency_checks
                                  set evidence_blob_hash = competency_evidence_blob_hash,
                                      evidence_file_name = dom_file.name,
                                      evidence_content_type = coalesce(nullif(dom_file.type, ''), 'application/octet-stream')
                                  where id = check.id
                                    and person_id = ui.person_id
                                `);
                                    s.commitTransaction();
                                    s.refetch();
                                  },
                                });
                              }}
                            />
                            {sql`case when check.has_evidence then 'Replace evidence' else 'Upload evidence' end`}
                          </Button>
                        </Show>
                        <Show when={sql`check.has_evidence`}>
                          <Button
                            component="a"
                            href={competencyEvidenceUrl(
                              sql`check.evidence_blob_hash`,
                            )}
                            target="_blank"
                            size="sm"
                            variant="plain"
                            color="neutral"
                            startIcon="OpenInNew"
                          >
                            Open evidence
                          </Button>
                        </Show>
                      </div>
                      <Show when={sql`check.evidence_file_name is not null`}>
                        <Typography
                          level="body-sm"
                          className="text-neutral-600 mt-2"
                        >
                          Evidence: {sql`check.evidence_file_name`}
                        </Typography>
                      </Show>
                    </div>
                  </Each>
                </div>
              </CardContent>
            </Card>
          )}

          {includeCompliance && (
            <Card variant="outlined">
              <CardHeader>
                <Typography level="title-lg" startIcon="Badge">
                  {complianceLabels.certificationsTitle}
                </Typography>
              </CardHeader>
              <CardContent>
                <Show when={sql`not exists (select 1 from certs)`}>
                  <EmptyState
                    icon="Badge"
                    title={complianceLabels.noCertificationsTitle}
                    body={complianceLabels.noCertificationsBody}
                  />
                </Show>
                <div className="grid gap-3">
                  <Each table="certs" recordName="cert">
                    <div className="p-4 border border-divider rounded-md bg-white">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Typography level="title-md">
                            {sql`cert.name`}
                          </Typography>
                          <Show
                            when={sql`cert.certification_number is not null`}
                          >
                            <Typography
                              level="body-sm"
                              className="text-neutral-600"
                            >
                              #{sql`cert.certification_number`}
                            </Typography>
                          </Show>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600"
                          >
                            {sql`coalesce(cert.source, 'No source recorded')`}
                          </Typography>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <StatusChip
                            fallbackLabel={sql`cert.expiration_status`}
                            cases={[
                              {
                                when:
                                  sql`cert.expiration_status = 'Superseded'`,
                                label: "Superseded",
                                color: "neutral",
                              },
                              {
                                when: sql`cert.expiration_status = 'Current'`,
                                label: "Current",
                                color: "success",
                              },
                              {
                                when:
                                  sql`cert.expiration_status = 'Expiring soon'`,
                                label: "Expiring",
                                color: "warning",
                              },
                              {
                                when: sql`cert.expiration_status = 'Expired'`,
                                label: "Expired",
                                color: "danger",
                              },
                            ]}
                          />
                          <StatusChip
                            fallbackLabel={sql`cert.approval_status`}
                            cases={[
                              {
                                when: sql`cert.approval_status = 'pending'`,
                                label: "Pending approval",
                                color: "warning",
                              },
                              {
                                when: sql`cert.approval_status = 'approved'`,
                                label: "Approved",
                                color: "success",
                              },
                              {
                                when: sql`cert.approval_status = 'rejected'`,
                                label: "Rejected",
                                color: "danger",
                              },
                            ]}
                          />
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600"
                          >
                            Issued
                          </Typography>
                          <Typography level="body-sm">
                            {sql`coalesce(${
                              formatDateSql(sql`cert.issued_at`)
                            }, 'Not recorded')`}
                          </Typography>
                        </div>
                        <div>
                          <Typography
                            level="body-sm"
                            className="text-neutral-600"
                          >
                            Expires
                          </Typography>
                          <Typography level="body-sm">
                            {sql`coalesce(${
                              formatDateSql(sql`cert.expires_at`)
                            }, 'No expiration')`}
                          </Typography>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Show
                          when={sql`cert.is_generated
                            and cert.approval_status = 'approved'`}
                        >
                          <Button
                            component="a"
                            href={generatedCertificateUrl(
                              sql`cert.access_token`,
                            )}
                            target="_blank"
                            size="sm"
                            variant="outlined"
                            color="primary"
                            startIcon="OpenInNew"
                          >
                            Open certificate
                          </Button>
                          <Button
                            component="a"
                            href={generatedCertificateDownloadUrl(
                              sql`cert.access_token`,
                            )}
                            size="sm"
                            variant="plain"
                            color="neutral"
                            startIcon="Download"
                          >
                            Download certificate
                          </Button>
                        </Show>
                        <Show
                          when={sql`not cert.is_generated
                            and can_manage_employee_files`}
                        >
                          <Button
                            component="label"
                            size="sm"
                            variant="outlined"
                            color="neutral"
                            startIcon="UploadFile"
                          >
                            <input
                              type="file"
                              sx={visuallyHiddenStyles}
                              onFileChange={(s) => {
                                s.defRecord(
                                  "dom_file",
                                  sql`select * from file limit 1`,
                                );
                                s.tryServer({
                                  transferFiles: sql`select uuid from file`,
                                  body: (s) => {
                                    block.assertCanManageEmployeeFiles(s);
                                    s.readDomFile(
                                      sql`dom_file.uuid`,
                                      "content",
                                    );
                                    s.createBlob(
                                      sql`content`,
                                      "cert_blob_hash",
                                    );
                                    s.startTransaction();
                                    s.modify(sql`
                                      update db.training_certifications
                                      set proof_blob_hash = cert_blob_hash,
                                          proof_file_name = dom_file.name,
                                          proof_content_type = coalesce(nullif(dom_file.type, ''), 'application/octet-stream')
                                      where id = cert.id
                                        and person_id = ui.person_id
                                    `);
                                    s.commitTransaction();
                                    s.refetch();
                                  },
                                });
                              }}
                            />
                            {sql`case when cert.has_proof then 'Replace proof' else 'Upload proof' end`}
                          </Button>
                        </Show>
                        <Show when={sql`cert.has_proof`}>
                          <Button
                            component="a"
                            href={certificationProofUrl(
                              sql`cert.proof_blob_hash`,
                            )}
                            target="_blank"
                            size="sm"
                            variant="plain"
                            color="neutral"
                            startIcon="OpenInNew"
                          >
                            Open proof
                          </Button>
                        </Show>
                        <Show
                          when={sql`can_validate_training
                            and cert.approval_status = 'pending'`}
                        >
                          <Button
                            size="sm"
                            variant="outlined"
                            color="success"
                            startIcon="Check"
                            onClick={(s) => {
                              s.tryServer({
                                body: (s) => {
                                  s.if(
                                    sql`not ${
                                      currentUserHasPermission(
                                        sql.lit(
                                          trainingPermissions.validateTraining,
                                        ),
                                      )
                                    }`,
                                    (s) => {
                                      s.throwError(
                                        sql
                                          .lit`You do not have permission to approve certifications.`,
                                      );
                                    },
                                  );
                                  s.startTransaction();
                                  s.modify(sql`
                                    update db.training_certifications
                                    set approval_status = 'approved',
                                        approved_by_id = ${
                                    currentEmployeeId(block.opts)
                                  },
                                        approved_at = now()
                                    where id = cert.id
                                      and approval_status = 'pending'
                                  `);
                                  s.commitTransaction();
                                  s.refetch();
                                },
                              });
                            }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="plain"
                            color="danger"
                            startIcon="Close"
                            onClick={(s) => {
                              s.tryServer({
                                body: (s) => {
                                  s.if(
                                    sql`not ${
                                      currentUserHasPermission(
                                        sql.lit(
                                          trainingPermissions.validateTraining,
                                        ),
                                      )
                                    }`,
                                    (s) => {
                                      s.throwError(
                                        sql
                                          .lit`You do not have permission to approve certifications.`,
                                      );
                                    },
                                  );
                                  s.startTransaction();
                                  s.modify(sql`
                                    update db.training_certifications
                                    set approval_status = 'rejected',
                                        approved_by_id = ${
                                    currentEmployeeId(block.opts)
                                  },
                                        approved_at = now()
                                    where id = cert.id
                                      and approval_status = 'pending'
                                  `);
                                  s.commitTransaction();
                                  s.refetch();
                                },
                              });
                            }}
                          >
                            Reject
                          </Button>
                        </Show>
                      </div>
                      <Show when={sql`cert.proof_file_name is not null`}>
                        <Typography
                          level="body-sm"
                          className="text-neutral-600 mt-2"
                        >
                          Proof: {sql`cert.proof_file_name`}
                        </Typography>
                      </Show>
                    </div>
                  </Each>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {includeCompliance && (
          <Card variant="outlined">
            <CardHeader>
              <Typography level="title-lg" startIcon="FolderShared">
                {complianceLabels.personnelTitle}
              </Typography>
            </CardHeader>
            <CardContent>
              <Show when={sql`not exists (select 1 from personnel_docs)`}>
                <EmptyState
                  icon="FolderShared"
                  title={complianceLabels.noPersonnelTitle}
                  body={complianceLabels.noPersonnelBody}
                />
              </Show>
              <div className="grid grid-cols-1 gap-3">
                <Each table="personnel_docs" recordName="doc">
                  <div className="p-4 border border-divider rounded-md bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Typography level="title-md">
                          {sql`doc.title`}
                        </Typography>
                        <Typography
                          level="body-sm"
                          className="text-neutral-600"
                        >
                          {formatDateTimeSql(sql`doc.created_at`)}
                        </Typography>
                      </div>
                      <Chip size="sm" variant="soft" color="neutral">
                        {sql`doc.kind`}
                      </Chip>
                    </div>
                    <Show when={sql`doc.notes is not null`}>
                      <Typography
                        level="body-sm"
                        className="text-neutral-700 mt-3"
                      >
                        {sql`doc.notes`}
                      </Typography>
                    </Show>
                    <Show when={sql`doc.file_name is not null`}>
                      <Typography
                        level="body-sm"
                        className="text-neutral-600 mt-3"
                      >
                        File: {sql`doc.file_name`}
                      </Typography>
                    </Show>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Show when={sql`can_manage_employee_files`}>
                        <Button
                          component="label"
                          size="sm"
                          variant="outlined"
                          color="neutral"
                          startIcon="UploadFile"
                        >
                          <input
                            type="file"
                            sx={visuallyHiddenStyles}
                            onFileChange={(s) => {
                              s.defRecord(
                                "dom_file",
                                sql`select * from file limit 1`,
                              );
                              s.tryServer({
                                transferFiles: sql`select uuid from file`,
                                body: (s) => {
                                  block.assertCanManageEmployeeFiles(s);
                                  s.readDomFile(sql`dom_file.uuid`, "content");
                                  s.createBlob(
                                    sql`content`,
                                    "personnel_blob_hash",
                                  );
                                  s.startTransaction();
                                  s.modify(sql`
                                update db.training_personnel_documents
                                set blob_hash = personnel_blob_hash,
                                    file_name = dom_file.name,
                                    content_type = coalesce(nullif(dom_file.type, ''), 'application/octet-stream')
                                where id = doc.id
                                  and person_id = ui.person_id
                              `);
                                  s.commitTransaction();
                                  s.refetch();
                                },
                              });
                            }}
                          />
                          {sql`case when doc.has_file then 'Replace file' else 'Upload file' end`}
                        </Button>
                      </Show>
                      <Show when={sql`doc.has_file`}>
                        <Button
                          component="a"
                          href={personnelDocumentUrl(
                            sql`doc.blob_hash`,
                          )}
                          target="_blank"
                          size="sm"
                          variant="plain"
                          color="neutral"
                          startIcon="OpenInNew"
                        >
                          Open file
                        </Button>
                      </Show>
                    </div>
                  </div>
                </Each>
              </div>
            </CardContent>
          </Card>
        )}
      </PageShell>
    </Data>
  );
}
