import {
  type EmailIntegrationConfig,
  EmailIntegrationsPage,
} from "blocks/email_integrations/email_integration_page";
import { AllEmailsList } from "blocks/email_integrations/common";
import { EmailDraftRoutes } from "blocks/email_integrations/drafts";
import { CommentsBlock } from "blocks/comments";
import type { CommentDiscussion } from "blocks/comments";
import { notificationAppHref } from "blocks/user_notifications";
import { GmailIntegration } from "blocks/email_integrations/gmail";
import { OutlookEmailIntegration } from "blocks/email_integrations/outlook_email";
import { AutoInsertButton } from "components/auto_insert_dialog";
import { MaterialIcon } from "components/material_icon";
import type { IconName } from "components/material_icon_names";
import { Typography } from "components/typography";
import { ensureLexicalRichTextFunctions } from "components/lexical/components/lexical_scalar_functions";
import { FieldGroup } from "field_groups/crm_field_group";
import type { FieldGroupBuilder } from "field_groups/crm_field_group";
import type { SampleDataScriptContext } from "std/sample_data";
import { singularize } from "std/inflectors";
import { sql } from "../../std/sql_utils";
import type { BooleanExpr, NumericExpr, Sql } from "../../std/sql_utils";
import type {
  GeneralServerStatements,
  IServerBaseStatements,
  UiServerStatements,
} from "std/statements";
import { registerCrmPipelineStoredProcedures } from "./pipeline/stored_procedures";
import { system } from "std/system";
import type { Block, HelperEnumValue, TableBuilder } from "std/system";
import { Route, Show, State } from "std/ui";
import type { Node } from "std/ui";
import { DatagridPage, useCellHelper } from "pages/datagrid";
import { AddressTableBlock } from "table_blocks/address";
import { KanbanProjectTableBlock } from "table_blocks/kanban_project";
import { AttachmentsTableBlock } from "table_blocks/attachments";
import {
  DetailFieldDisplayOnly,
  EditSimpleField,
  OrganizationDetailContent,
  OrganizationDetailPage,
  PersonDetailContent,
  PersonDetailPage,
} from "./detail_page";
import {
  OrganizationsOverviewReport,
  PeopleOverviewReport,
  WelcomeBackReport,
} from "./reports";
import * as YolmGenApi from "std/yolm_gen_api";
import type {
  PipelineConfig,
  PipelineStageConfig,
  PipelineStageFieldConfig,
} from "./pipeline/types";
import {
  addToPipeline,
  createAutoTasksForStage,
  PipelineBoard,
  removeFromPipeline,
} from "./pipeline/board";
import { ExitCriteriaChecklist } from "./pipeline/exit_criteria";
import { PipelineItemDetailPage } from "./pipeline/item_detail";
import { PipelinePages } from "./pipeline/pages";
import {
  PipelineOverviewReport,
  PipelineTasksReport,
  QualificationScoreDistribution,
  SalesDashboard,
} from "./pipeline/reports";
import { StageFieldsForm } from "./pipeline/stage_fields";
import { OverdueTasksAlert, PipelineTaskList } from "./pipeline/tasks";
import {
  AdoptionValueDashboard,
  OperatingRhythmDashboard,
  PartnerMetricsDashboard,
  RYGScorecards,
} from "./pipeline/dashboards";
import {
  ProjectDetailPage,
  ProjectListPage,
  ProjectNewPage,
  ProjectOrganizationTab,
} from "./projects/index";
import {
  SuccessPlanDetailPage,
  SuccessPlanListPage,
  SuccessPlanNewPage,
} from "./success_plans/index";
import {
  KnowledgeHubOrganizationTab,
  KnowledgeHubPage,
  KnowledgeItemDetailPage,
  KnowledgeItemNewPage,
} from "./knowledge_hub/index";
import { EntityPipelineStatusTab } from "./pipeline/entity_status";
import {
  ExtendedItemDetailsCard,
  ExtendedItemFieldsForm,
  getExtendedItemFieldsFromWriteState,
} from "./pipeline/extended_item_fields";
import { registerPartnerAutomationReactors } from "./reactors/partner_automation";
import { registerRenewalTaskReactor } from "./reactors/renewal_tasks";
import { toDisplayName } from "./helpers";
import { registerCrmScoreProcedures } from "./score_assessment";
export type {
  ExitCriterion,
  PipelineActivityType,
  PipelineConfig,
  PipelineEntityType,
  PipelineStageAutoTask,
  PipelineStageConfig,
  PipelineStageFieldConfig,
} from "./pipeline/types";
export type { ExtendedItemFields } from "./pipeline/board";
export type { ExtendedItemFieldLabels } from "./pipeline/extended_item_fields";

/**
 * Per-route path and datagrid-name overrides for {@link CrmBlock}. Any path
 * left unset falls back to the block's defaults (e.g. `/organizations`,
 * `/contacts`, `/pipelines`); detail/new paths default to nesting under their
 * list path. Set on {@link CrmBlockOpts.routes}.
 */
export interface CrmRouteConfig {
  organizationsListPath?: string;
  organizationDetailPath?: string;
  peopleListPath?: string;
  personDetailPath?: string;
  pipelinesPath?: string;
  pipelineItemDetailPath?: string;
  projectsListPath?: string;
  projectDetailPath?: string;
  projectNewPath?: string;
  successPlansListPath?: string;
  successPlanDetailPath?: string;
  successPlanNewPath?: string;
  knowledgeHubListPath?: string;
  knowledgeHubDetailPath?: string;
  knowledgeHubNewPath?: string;
  partnersListPath?: string;
  industriesListPath?: string;
  inboxPath?: string;
  emailDraftsPath?: string;
  emailDraftDetailPath?: string;
  emailIntegrationsPath?: string;
  organizationsDatagridName?: string;
  peopleDatagridName?: string;
}

interface CrmResolvedRouteConfig extends
  Required<
    Omit<CrmRouteConfig, "organizationsDatagridName" | "peopleDatagridName">
  > {
  organizationsDatagridName?: string;
  peopleDatagridName?: string;
}

/**
 * Toggles for the background reactors the CRM registers automatically. Each
 * flag is a no-op unless its prerequisite feature is enabled (e.g. partners
 * needs a partner-attachment pipeline; renewals need success plans). Set on
 * {@link CrmBlockOpts.automations}.
 */
export interface CrmAutomationConfig {
  /** Partner notification/co-sell reactors. */
  partners?: boolean;
  /** "Renewal Prep" auto-tasks on pipeline-linked success plans. */
  renewalTasks?: boolean;
}

/** Statement builder passed to {@link CrmDebugHooks} callbacks. */
export type CrmDebugHookStatements =
  | GeneralServerStatements
  | IServerBaseStatements
  | UiServerStatements;

/** Context for {@link CrmDebugHooks.afterPipelineItemCreated}. */
export interface CrmPipelineItemCreatedHookContext {
  pipelineName: string;
  entityType: "organization" | "person";
  /** Id of the organization or person the item was created for. */
  entityId: NumericExpr;
  /** Id of the newly created pipeline item. */
  itemId: NumericExpr;
  /** Stage the item entered at. */
  stageName: string;
}

/** Context for {@link CrmDebugHooks.afterPipelineStageChanged}. */
export interface CrmPipelineStageChangedHookContext {
  pipelineName: string;
  itemId: NumericExpr;
  /** Stage the item moved from (SQL expression). */
  fromStage: Sql;
  /** Stage the item moved to. */
  toStage: string;
}

/** Context for {@link CrmDebugHooks.afterPipelineItemRemoved}. */
export interface CrmPipelineItemRemovedHookContext {
  itemId: NumericExpr;
  pipelineName: Sql;
  stageName: Sql;
}

/** Context for {@link CrmDebugHooks.afterPipelineAutoTaskCreated}. */
export interface CrmPipelineAutoTaskCreatedHookContext {
  pipelineName: string;
  stageName: string;
  itemId: NumericExpr;
  /** Title of the auto-created task. */
  title: string;
}

/**
 * Optional callbacks fired after CRM pipeline mutations, primarily for tests
 * and instrumentation. Each runs as part of the same write and receives a
 * statement builder plus the relevant context. Set on
 * {@link CrmBlockOpts.debugHooks}.
 */
export interface CrmDebugHooks {
  afterPipelineItemCreated?: (
    s: CrmDebugHookStatements,
    ctx: CrmPipelineItemCreatedHookContext,
  ) => void;
  afterPipelineStageChanged?: (
    s: CrmDebugHookStatements,
    ctx: CrmPipelineStageChangedHookContext,
  ) => void;
  afterPipelineItemRemoved?: (
    s: CrmDebugHookStatements,
    ctx: CrmPipelineItemRemovedHookContext,
  ) => void;
  afterPipelineAutoTaskCreated?: (
    s: CrmDebugHookStatements,
    ctx: CrmPipelineAutoTaskCreatedHookContext,
  ) => void;
}

/**
 * Override for a single route in {@link CrmStandardRoutes}: pass a `Node` to
 * replace the default page, or `false` to suppress the route entirely.
 */
export type StandardRouteOverride = Node | false;

/**
 * Per-route overrides for {@link CrmStandardRoutes}. Omit a key to keep the
 * block's default page for that route; see {@link StandardRouteOverride}.
 */
export interface CrmStandardRouteOverrides {
  organizationsList?: StandardRouteOverride;
  organizationDetail?: StandardRouteOverride;
  peopleList?: StandardRouteOverride;
  personDetail?: StandardRouteOverride;
  pipelines?: StandardRouteOverride;
  pipelineItemDetail?: StandardRouteOverride;
  projectsList?: StandardRouteOverride;
  projectDetail?: StandardRouteOverride;
  projectNew?: StandardRouteOverride;
  successPlansList?: StandardRouteOverride;
  successPlanDetail?: StandardRouteOverride;
  successPlanNew?: StandardRouteOverride;
  knowledgeHubList?: StandardRouteOverride;
  knowledgeHubDetail?: StandardRouteOverride;
  knowledgeHubNew?: StandardRouteOverride;
  partnersList?: StandardRouteOverride;
  industriesList?: StandardRouteOverride;
  inbox?: StandardRouteOverride;
  emailDrafts?: StandardRouteOverride;
  emailIntegrations?: StandardRouteOverride;
}

/** Props for {@link CrmBlock.StandardRoutes}. */
export interface CrmStandardRoutesProps {
  overrides?: CrmStandardRouteOverrides;
}

/**
Block that implements CRM contacts, organizations, pipelines, projects, and email integrations with configurable B2B or B2C approach.

When to use:
- When you need to manage organizations/clients and/or individual contacts
- When you need to manage leads and opportunities
- When you need to manage projects and tasks for clients

Provides:
- Organizations table (for B2B) with name, website, phone, description fields
- People/contacts table with first name, last name, email, phone, title fields
  (linked to organizations in B2B mode)
- Any custom fields for organizations and people
- Search configuration for all tables
- Sample data generation
- Pre-built detail pages and reports

The block is configurable via table names and custom field definitions for both organizations and people tables.

If you have a  CRM (B2B or B2C) use this block.

When you use this block, do not define the client/organization/company and contact/person tables outside of this block, but within it instead.

@category Block
 */
export class CrmBlock implements Block {
  blockName = "CrmBlock";
  #organizationsTableName?: string;
  #peopleTableName?: string;
  #crmType: CRMType;
  #organizationFieldGroups: FieldGroup[] = [];
  #peopleFieldGroups: FieldGroup[] = [];
  componentDependencies: string[] = [];
  description: string | undefined;

  #pipelineTablePrefix: string;
  #pipelineItemsTableName: string;
  #pipelineStageDataTableName: string;
  #pipelineTasksTableName: string;
  #pipelineActivityLogTableName: string;
  #pipelineEnumName: string;
  #pipelineEntityTypeEnumName: string;
  #pipelineActivityTypeEnumName: string;
  #hasAnyPipelineTasks = false;
  #hasAnyPipelineActivityLog = false;

  #projectsTableName: string;
  #successPlansTableName: string;
  #knowledgeHubTableName: string;
  #partnerNotificationsTableName: string;
  #routes: CrmResolvedRouteConfig;

  constructor(public opts: CrmBlockOpts) {
    this.#crmType = opts.type ?? "b2b";

    this.#pipelineTablePrefix = opts.pipelines?.tablePrefix ?? "crm_pipeline";
    this.#pipelineItemsTableName = `${this.#pipelineTablePrefix}_items`;
    this.#pipelineStageDataTableName =
      `${this.#pipelineTablePrefix}_stage_data`;
    this.#pipelineTasksTableName = `${this.#pipelineTablePrefix}_tasks`;
    this.#pipelineActivityLogTableName =
      `${this.#pipelineTablePrefix}_activity_log`;
    this.#pipelineEnumName = `${this.#pipelineTablePrefix}_name`;
    this.#pipelineEntityTypeEnumName =
      `${this.#pipelineTablePrefix}_entity_type`;
    this.#pipelineActivityTypeEnumName =
      `${this.#pipelineTablePrefix}_activity_type`;

    this.#projectsTableName = opts.projects?.tableName ?? "crm_projects";
    this.#successPlansTableName = opts.successPlans?.tableName ??
      "crm_success_plans";
    this.#knowledgeHubTableName = opts.knowledgeHub?.tableName ??
      "crm_knowledge_hub";
    this.#partnerNotificationsTableName = "crm_partner_notifications";
    this.#routes = {
      organizationsListPath: opts.routes?.organizationsListPath ??
        "/organizations",
      organizationDetailPath: opts.routes?.organizationDetailPath ??
        `${
          opts.routes?.organizationsListPath ?? "/organizations"
        }/{record_id:id}`,
      peopleListPath: opts.routes?.peopleListPath ?? "/contacts",
      personDetailPath: opts.routes?.personDetailPath ??
        `${opts.routes?.peopleListPath ?? "/contacts"}/{record_id:id}`,
      pipelinesPath: opts.routes?.pipelinesPath ?? "/pipelines",
      pipelineItemDetailPath: opts.routes?.pipelineItemDetailPath ??
        "/pipeline-items/{record_id:id}",
      projectsListPath: opts.routes?.projectsListPath ?? "/projects",
      projectDetailPath: opts.routes?.projectDetailPath ??
        `${opts.routes?.projectsListPath ?? "/projects"}/{record_id:id}`,
      projectNewPath: opts.routes?.projectNewPath ??
        `${opts.routes?.projectsListPath ?? "/projects"}/new`,
      successPlansListPath: opts.routes?.successPlansListPath ??
        "/success-plans",
      successPlanDetailPath: opts.routes?.successPlanDetailPath ??
        `${
          opts.routes?.successPlansListPath ?? "/success-plans"
        }/{record_id:id}`,
      successPlanNewPath: opts.routes?.successPlanNewPath ??
        `${opts.routes?.successPlansListPath ?? "/success-plans"}/new`,
      knowledgeHubListPath: opts.routes?.knowledgeHubListPath ??
        "/knowledge-hub",
      knowledgeHubDetailPath: opts.routes?.knowledgeHubDetailPath ??
        `${
          opts.routes?.knowledgeHubListPath ?? "/knowledge-hub"
        }/{record_id:id}`,
      knowledgeHubNewPath: opts.routes?.knowledgeHubNewPath ??
        `${opts.routes?.knowledgeHubListPath ?? "/knowledge-hub"}/new`,
      partnersListPath: opts.routes?.partnersListPath ?? "/partners",
      industriesListPath: opts.routes?.industriesListPath ?? "/industries",
      inboxPath: opts.routes?.inboxPath ?? "/inbox",
      emailDraftsPath: opts.routes?.emailDraftsPath ?? "/email-drafts",
      emailDraftDetailPath: opts.routes?.emailDraftDetailPath ??
        `${opts.routes?.emailDraftsPath ?? "/email-drafts"}/{record_id:id}`,
      emailIntegrationsPath: opts.routes?.emailIntegrationsPath ??
        "/email-integrations",
      organizationsDatagridName: opts.routes?.organizationsDatagridName,
      peopleDatagridName: opts.routes?.peopleDatagridName,
    };

    if (opts.organizations?.fieldGroups) {
      this.#organizationFieldGroups = opts.organizations.fieldGroups.map(
        (config) => {
          const fg = new FieldGroup(
            config.name,
            config.displayLocation || "details",
            config.icon,
            config.displayName,
          );
          return fg;
        },
      );
    }

    if (opts.people?.fieldGroups) {
      this.#peopleFieldGroups = opts.people.fieldGroups.map((config) => {
        const fg = new FieldGroup(
          config.name,
          config.displayLocation || "details",
          config.icon,
          config.displayName,
        );
        return fg;
      });
    }
  }

  populate() {
    registerCrmPipelineStoredProcedures(this);
    registerCrmScoreProcedures(this);
  }

  initialize() {
    if (this.hasSuccessPlansEnabled()) {
      const { good, warning } = this.healthScoreThresholds;
      if (
        !Number.isFinite(good) || !Number.isFinite(warning) || warning < 0 ||
        good > 100 || warning >= good ||
        !Number.isInteger(this.renewalUpcomingDays) ||
        this.renewalUpcomingDays < 1
      ) {
        throw new Error(
          "CrmBlock successPlans requires 0 <= warning < good <= 100 and a positive integer renewalUpcomingDays.",
        );
      }
    }
    if (
      this.opts.partners?.program &&
      (!Number.isFinite(this.opts.partners.program.coSellReadinessThreshold) ||
        this.opts.partners.program.coSellReadinessThreshold < 0 ||
        this.opts.partners.program.coSellReadinessThreshold > 100)
    ) {
      throw new Error(
        "CrmBlock partner coSellReadinessThreshold must be between 0 and 100.",
      );
    }
    if (this.hasKnowledgeHubEnabled() && !this.knowledgeHubItemTypes.length) {
      throw new Error("CrmBlock knowledgeHub requires at least one item type.");
    }
    if (this.opts.projects?.enabled && !this.opts.projects.phases.length) {
      throw new Error("CrmBlock projects requires at least one phase.");
    }
    if (
      this.hasRaciEnabled() &&
      !this.pipelines.some((p) => this.hasPipelineTasksEnabled(p.name))
    ) {
      throw new Error(
        "CrmBlock projects.enableRaci requires a pipeline with tasks enabled.",
      );
    }
    if (
      this.#crmType === "b2c" &&
      this.opts.organizations?.createTable !== true &&
      (this.hasProjectsEnabled() || this.hasSuccessPlansEnabled() ||
        this.hasKnowledgeHubEnabled() || this.opts.partners?.accountPlans)
    ) {
      throw new Error(
        "CrmBlock organization-based features require organizations.createTable in B2C mode.",
      );
    }
    for (const pipeline of this.pipelines) {
      if (!pipeline.stages.length) {
        throw new Error(
          `CRM pipeline "${pipeline.name}" requires at least one stage.`,
        );
      }
      if (
        this.#crmType === "b2c" &&
        pipeline.entityTypes.includes("organization") &&
        this.opts.organizations?.createTable !== true
      ) {
        throw new Error(
          `CRM pipeline "${pipeline.name}" requires an organizations table.`,
        );
      }
    }
    if (
      this.opts.partners &&
      !this.pipelines.some((p) => p.enablePartnerAttachment)
    ) {
      throw new Error(
        "CrmBlock partners configuration requires a partner-attachment pipeline.",
      );
    }
    this.#organizationsTableName = this.opts.organizations?.tableName ??
      "organizations";
    this.#peopleTableName = this.opts.people?.tableName ??
      (this.#crmType === "b2b" ? "contacts" : "customers");

    if (this.hasEmailDraftsEnabled()) {
      ensureLexicalRichTextFunctions(system);
    }

    if (
      this.#crmType === "b2b"
        ? this.opts.organizations?.createTable !== false
        : this.opts.organizations?.createTable === true
    ) {
      this.#createOrganizationRelationshipStateEnum();
      this.#createOrganizationsTable();
    }

    this.#createPeopleTable();

    if (this.opts.emailIntegrations) {
      this.#createEmailTables();
    }

    const needsPartners = this.opts.pipelines?.pipelines?.some((p) =>
      p.enablePartnerAttachment
    );
    if (needsPartners) {
      this.#createPartnersTable();
    }

    if (
      this.opts.pipelines?.pipelines && this.opts.pipelines.pipelines.length > 0
    ) {
      this.#initializePipelines();
    }

    if (this.opts.projects?.enabled) {
      this.#createProjectsTable();
    }

    if (this.opts.successPlans?.enabled) {
      this.#createSuccessPlansTable();
    }

    if (this.opts.knowledgeHub?.enabled) {
      this.#createKnowledgeHubTable();
    }

    if (needsPartners && this.opts.automations?.partners) {
      this.ensurePartnerNotificationsTable();
    }

    this.#registerConfiguredAutomations();

    this.componentDependencies = [
      "PersonDetailPage",
      ...(this.#crmType === "b2b" ? ["OrganizationDetailPage"] : []),
      "Reports",
      ...(this.opts.pipelines?.pipelines?.length
        ? ["PipelineBoard", "PipelineItemDetail", "PipelineReports"]
        : []),
      ...(this.opts.projects?.enabled ? ["Projects"] : []),
      ...(this.opts.successPlans?.enabled ? ["SuccessPlans"] : []),
      ...(this.opts.knowledgeHub?.enabled ? ["KnowledgeHub"] : []),
    ];
    const features = [
      this.opts.pipelines?.pipelines?.length
        ? `${this.opts.pipelines.pipelines.length} pipeline(s)`
        : null,
      this.opts.projects?.enabled ? "project tracking" : null,
      this.opts.successPlans?.enabled ? "success plans" : null,
      this.opts.knowledgeHub?.enabled ? "knowledge hub" : null,
    ].filter(Boolean);
    this.description =
      `Provides a complete ${this.#crmType.toUpperCase()} CRM system` +
      (this.#crmType === "b2b"
        ? " with organizations and contacts."
        : " focused on individual customers.") +
      (features.length ? ` Includes ${features.join(", ")}.` : "");
  }

  validate() {
    const commentTables = [
      ...(this.opts.organizations?.commentSection
        ? [this.organizationsTableName]
        : []),
      ...(this.opts.people?.commentSection ? [this.peopleTableName] : []),
    ];
    if (commentTables.length === 0) return;

    const comments = system.blockOptional(CommentsBlock);
    if (!comments) {
      throw new Error(
        "CrmBlock commentSection requires one configured CommentsBlock.",
      );
    }
    const threadTable = system.db.tables[comments.threadTable];
    for (const tableName of commentTables) {
      const fieldName = `${singularize(tableName)}_id`;
      const field = threadTable.fields[fieldName];
      if (
        !field || field.type !== "ForeignKey" || field.table !== tableName
      ) {
        throw new Error(
          `CrmBlock commentSection requires CommentsBlock defineThread to add ${fieldName} -> ${tableName}.`,
        );
      }
    }
  }

  #registerConfiguredAutomations() {
    if (this.opts.automations?.partners) {
      registerPartnerAutomationReactors(this);
    }
    if (this.opts.automations?.renewalTasks) {
      registerRenewalTaskReactor(this);
    }
  }

  #createOrganizationsTable() {
    system.db.table(this.#organizationsTableName!, (table) => {
      this.#configureSampleData(table, 250);

      table
        .string("name", 255)
        .notNull()
        .sampleData({
          generator: (_ctx) => sql.lit(YolmGenApi.fakerCompanyName()),
        });
      table.url("website", 255);
      table.phoneNumberString("phone", { country: this.opts.phoneCountry });
      table.string("description", 2000);
      this.#addOrganizationRelationshipStateFields(table);

      // Apply field groups
      for (let i = 0; i < this.#organizationFieldGroups.length; i++) {
        const fieldGroup = this.#organizationFieldGroups[i];
        const config = this.opts.organizations?.fieldGroups?.[i];
        if (config) {
          fieldGroup.apply(
            table,
            config.define,
            this.opts.organizations?.fieldGroupPrefix,
          );
        }
      }

      this.opts.organizations?.define?.(table, new OrganizationConfig(table));
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
      if (!table.hasSearchConfig()) {
        this.#configureSearchFields(table, [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ]);
      }
    });
  }

  #createOrganizationRelationshipStateEnum() {
    const relationshipState = this.opts.organizationRelationshipState;
    if (!relationshipState) return;
    system.enum_({
      name: this.organizationRelationshipDispositionEnumName,
      values: relationshipState.disposition.values,
    });
  }

  #addOrganizationRelationshipStateFields(table: TableBuilder) {
    const relationshipState = this.opts.organizationRelationshipState;
    if (!relationshipState) return;

    table.enum(
      this.organizationRelationshipDispositionFieldName,
      this.organizationRelationshipDispositionEnumName,
    ).displayName(relationshipState.disposition.displayName ?? "Disposition");

    if (!relationshipState.snooze) return;
    table.date(this.organizationRelationshipSnoozeUntilFieldName).displayName(
      "Snoozed until",
    );
    if (relationshipState.snooze.reasonFieldName !== false) {
      table.string(
        this.organizationRelationshipSnoozeReasonFieldName,
        relationshipState.snooze.reasonMaxLength ?? 500,
      ).displayName("Snooze reason");
    }
  }

  #createPeopleTable() {
    system.db.table(this.#peopleTableName!, (table) => {
      this.#configureSampleData(table, 500);

      this.#addOrganizationForeignKey(table);

      this.#addDefaultPersonFields(table);

      if (this.#crmType === "b2b") {
        table.string("title", 255);
      }

      this.#addB2CFields(table);

      // Apply field groups
      for (let i = 0; i < this.#peopleFieldGroups.length; i++) {
        const fieldGroup = this.#peopleFieldGroups[i];
        const config = this.opts.people?.fieldGroups?.[i];
        if (config) {
          fieldGroup.apply(
            table,
            config.define,
            this.opts.people?.fieldGroupPrefix,
          );
        }
      }

      this.opts.people?.define?.(table, new PeopleConfig(table));

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);

      if (!table.hasSearchConfig()) {
        table.searchConfig({
          fieldGroups: [{ fields: ["first_name", "last_name"], priority: 1 }],
          fields: [{ field: "email", priority: 2 }],
        });
      }

      table.virtual(
        "full_name",
        sql`(trim(concat(${sql.ref(this.#peopleTableName!)}.first_name, ' ', ${
          sql.ref(this.#peopleTableName!)
        }.last_name)))`,
      );
    });
  }

  #configureSampleData(table: TableBuilder, baseCount: number) {
    table.sampleData({
      baseCount,
    });
  }

  #configureSearchFields(
    table: TableBuilder,
    fields: { field: string; priority: number }[],
  ) {
    table.searchConfig({
      fields,
    });
  }

  #organizationDeletionMode(): CrmOrganizationDeletionMode {
    return this.opts.organizations?.deletion?.mode ?? "emptyOnly";
  }

  #organizationChildOnDelete() {
    return this.#organizationDeletionMode() === "emptyOnly"
      ? "Restrict"
      : "Cascade";
  }

  #addOrganizationForeignKey(table: TableBuilder) {
    if (
      this.#crmType === "b2b"
    ) {
      table.fk(this.#organizationsTableName!).onDelete(
        this.#organizationChildOnDelete(),
      ).sampleData({
        foreignKeyStrategy: {
          type: "mixed",
          newProbability: 20,
        },
        nullProbability: 1,
      });
    }
  }

  #addDefaultPersonFields(table: TableBuilder) {
    if (!this.opts.people?.disableDefaultFields) {
      const firstName = table.string("first_name", 255);
      if (this.opts.people.defaultFieldsRequired !== false) {
        firstName.notNull();
      }
      table.string("last_name", 255);
      table.email("email");
      table.phoneNumberString("phone", { country: this.opts.phoneCountry });
    }
  }

  #addB2CFields(table: TableBuilder) {
    if (
      this.#crmType === "b2c" &&
      this.opts.people?.addDefaultB2CFields !== false
    ) {
      table.date("birth_date");
      table.enum("gender", "gender_enum");
      table.addBlock(AddressTableBlock, {
        name: "personal_address",
        prefix: "personal_",
        createFields: { streetTwo: true },
      });
      table.enum("preferred_contact_method", "contact_preference_enum");
    }
  }

  #createEmailTables() {
    const hasOutlookIntegration = this.opts.emailIntegrations?.some(
      (integration) => integration.integration === OutlookEmailIntegration,
    ) ?? false;
    const hasGmailIntegration = this.opts.emailIntegrations?.some(
      (integration) => integration.integration === GmailIntegration,
    ) ?? false;
    if (hasOutlookIntegration && hasGmailIntegration) {
      throw new Error(
        "CrmBlock does not yet support one archive with both Gmail and Outlook",
      );
    }
    if (hasOutlookIntegration) {
      system.db.table("user_email_identities", (table) => {
        table.sampleData({ skipSampleData: true });
        table.string("identity_key", 600).notNull().collation("Binary")
          .unique();
      });
    }
    system.db.table("user_all_emails", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      this.#addEmailIntegrationForeignKeys(table);
      this.#addEmailBaseFields(table);
      if (hasOutlookIntegration) {
        table.fk("user_email_identities").notNull().onDelete("Restrict");
        table.bytes("body_blob", 32);
        table.string("in_reply_to", 500).collation("Binary");
        table.json("message_references");
        table.string("thread_key", 600).collation("Binary");
        table.timestampUtc("hydrated_at");
        table.timestampUtc("provider_deleted_at");
        table.smallUint("hydrate_attempt_count").notNull().default(sql`0`);
        table.timestampUtc("hydrate_after").notNull().default(sql`now()`);
        table.string("hydrate_error", 5000);
      }
      if (
        this.opts.emailIntegrations?.some(
          (integration) => integration.integration === OutlookEmailIntegration,
        )
      ) {
        table.unique(["user_outlook_emails_account_id", "message_id"]);
      }
    });

    system.db.table("user_email_recipients", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("user_all_emails").notNull().onDelete("Cascade");
      table.string("email", 500);
      if (!hasOutlookIntegration) {
        table.string("recipient_address", 500);
      }
      table.enum("recipient_type", "recipient_type_enum").notNull();
      table.unique(["user_all_email_id", "email", "recipient_type"]);
    });

    system.db.table("user_email_attachments", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.fk("user_all_emails").notNull().onDelete("Cascade");
      if (!hasOutlookIntegration) {
        table.string("message_id", 500).notNull();
      }
      this.#addEmailAttachmentFields(table, hasOutlookIntegration);
      if (hasOutlookIntegration) {
        table.timestampUtc("provider_deleted_at");
        table.bigUint("size_bytes");
      }
      table.unique(["user_all_email_id", "attachment_id"]);
    });

    if (this.hasEmailDraftsEnabled()) {
      system.enum_({
        name: "user_email_draft_status",
        values: ["draft", "sending", "failed", "send_unknown"],
      });
      system.db.table("user_email_drafts", (table) => {
        table.description(
          "Application-owned one-to-one email drafts and their send lifecycle.",
        );
        table.sampleData({ skipSampleData: true });
        table.fk("sys_users").notNull().onDelete("Cascade");
        table.enum("status", "user_email_draft_status").notNull().default(
          sql.lit`draft`,
        );
        table.string("integration_key", 20);
        table.bigUint("account_id");
        table.email("from_email");
        table.string("subject", 1000).notNull().default(sql.lit``);
        table.json("body").notNull().default(
          sql`lexical_simple_paragraph('')`,
        );
        table.string("last_error", 2000);
        table.timestampUtc("created_at").notNull().default(sql`now()`);
        table.timestampUtc("updated_at").notNull().default(sql`now()`);
        table.timestampUtc("send_started_at");
        table.skipAutoApi();
      });
      system.db.table("user_email_draft_recipients", (table) => {
        table.description(
          "To, Cc, and Bcc recipients owned by one email draft.",
        );
        table.sampleData({ skipSampleData: true });
        table.fk("user_email_drafts").notNull().onDelete("Cascade");
        table.enum("recipient_type", "recipient_type_enum").notNull();
        table.email("email").notNull();
        table.unique(["user_email_draft_id", "recipient_type", "email"]);
        table.skipAutoApi();
      });
      system.db.table("user_email_draft_attachments", (table) => {
        table.description("Blob-backed attachments owned by one email draft.");
        table.sampleData({ skipSampleData: true });
        table.fk("user_email_drafts").notNull().onDelete("Cascade");
        table.string("name", 255).notNull();
        table.string("content_type", 255).notNull();
        table.bigUint("size_bytes").notNull();
        table.blobRef("blob", 64).notNull();
        table.skipAutoApi();
      });
      system.addReactor({
        name: "user_email_draft_stale_send_fence",
        query: sql`select id
          from user_email_drafts
          where status = 'sending'
            and send_started_at < date.add(minute, -10, now())`,
        recordName: "stale_user_email_draft",
        maxConcurrent: 1,
        procedure: (s) => {
          s.startTransaction();
          s.modify(sql`update user_email_drafts
            set status = 'send_unknown', updated_at = now(),
                last_error = 'The send lease expired; check the mailbox before resolving this draft'
            where id = stale_user_email_draft.id
              and status = 'sending'
              and send_started_at < date.add(minute, -10, now())`);
          s.commitTransaction();
        },
      });
    }
    if (hasOutlookIntegration) {
      system.db.view(
        "user_email_occurrence_map",
        sql`
          with canonical_ids as (
            select
              candidate.user_email_identity_id,
              coalesce(
                min(candidate.id) filter (where
                  candidate.provider_deleted_at is null
                  and (candidate.body_text is not null or candidate.body_blob is not null)
                ),
                min(candidate.id) filter (where
                  candidate.provider_deleted_at is null
                ),
                min(candidate.id) filter (where
                  candidate.body_text is not null or candidate.body_blob is not null
                ),
                min(candidate.id)
              ) as canonical_user_all_email_id
            from db.user_all_emails candidate
            group by candidate.user_email_identity_id
          )
          select
            email.id as user_all_email_id,
            email.user_email_identity_id,
            email.user_outlook_emails_account_id,
            email.message_id as provider_message_id,
            canonical.canonical_user_all_email_id
          from db.user_all_emails email
          join canonical_ids canonical
            on canonical.user_email_identity_id = email.user_email_identity_id
        `,
      );
      system.db.view(
        "canonical_user_emails",
        sql`
          select email.*
          from db.user_all_emails email
          join db.user_email_occurrence_map occurrence
            on occurrence.user_all_email_id = email.id
            and occurrence.canonical_user_all_email_id = email.id
        `,
      );
      system.db.view(
        "user_email_attachment_source_map",
        sql`
          with attachment_stats as (
            select
              attachment.user_all_email_id,
              count(*) as attachment_count,
              sum(case when attachment.data is not null then 1 else 0 end)
                as complete_attachment_count
            from db.user_email_attachments attachment
            where attachment.provider_deleted_at is null
            group by attachment.user_all_email_id
          ), ranked_attachment_sources as (
            select
              email.id,
              email.user_email_identity_id,
              row_number() over (
                partition by email.user_email_identity_id
                order by
                  (email.provider_deleted_at is null) desc,
                  coalesce(attachment.complete_attachment_count, 0) desc,
                  coalesce(attachment.attachment_count, 0) desc,
                  email.id
              ) as attachment_rank
            from db.user_all_emails email
            left join attachment_stats attachment
              on attachment.user_all_email_id = email.id
          )
          select
            source.user_email_identity_id,
            source.id as attachment_user_all_email_id
          from ranked_attachment_sources source
          where source.attachment_rank = 1
        `,
      );
    }
  }

  #addEmailIntegrationForeignKeys(table: TableBuilder) {
    if (
      this.opts.emailIntegrations?.some(
        (i) => i.integration === GmailIntegration,
      )
    ) {
      table.fk("user_gmail_accounts").onDelete("Cascade");
    }
    if (
      this.opts.emailIntegrations?.some(
        (i) => i.integration === OutlookEmailIntegration,
      )
    ) {
      table.fk("user_outlook_emails_accounts").onDelete("SetToNull");
    }
  }

  #addEmailBaseFields(table: TableBuilder) {
    const hasOutlookIntegration = this.opts.emailIntegrations?.some(
      (integration) => integration.integration === OutlookEmailIntegration,
    ) ?? false;
    const messageId = table.string("message_id", 500).notNull();
    const threadId = table.string("thread_id", 500);
    const messageReplyId = table.string("message_reply_id", 500);
    if (hasOutlookIntegration) {
      messageId.collation("Binary");
      threadId.collation("Binary");
      messageReplyId.collation("Binary");
    }
    table.string("subject", 1000);
    table.string("snippet", 1000);
    table.string("from", 500);
    table.string("from_email", 500);
    table.string("reply_to", 2000);
    table.timestamp("date");
    table.string("body_text", 1000000);
    table.bool("is_read").notNull().default(false);
    table.bool("has_attachments").notNull().default(false);
    if (!hasOutlookIntegration) {
      table.json("body_rich_text");
    }
    table.searchConfig({
      fields: [
        {
          field: "subject",
          priority: 1,
        },
      ],
    });
  }

  #addEmailAttachmentFields(
    table: TableBuilder,
    hasOutlookIntegration: boolean,
  ) {
    const attachmentId = table.string("attachment_id", 500);
    if (
      this.opts.emailIntegrations?.some(
        (integration) => integration.integration === OutlookEmailIntegration,
      )
    ) {
      attachmentId.collation("Binary");
    }
    if (hasOutlookIntegration) {
      table.enum("kind", "outlook_email_attachment_kind").notNull();
    } else {
      table.string("attachment_type", 100);
    }
    table.string("filename", 500);
    table.string("content_type", 500);
    table.bytes("data", 64);
    table.string("content_id", 1000);
    table.bool("is_inline").default(false);
    table.string("external_url", 5000);
    if (!hasOutlookIntegration) {
      table.string("ccid", 1000);
      table.string("provider_type", 100);
    }
  }

  #createPartnersTable() {
    const program = this.opts.partners?.program;
    if (program) {
      system.enum_({
        name: "crm_partner_type",
        values: [
          { name: "valued_reseller", displayName: "Valued Reseller" },
          { name: "affiliate", displayName: "Affiliate" },
          { name: "industry_solution", displayName: "Industry Solution" },
        ],
      });

      system.enum_({
        name: "crm_partner_validation_status",
        values: [
          { name: "pending", displayName: "Pending", color: "#F59E0B" },
          { name: "validated", displayName: "Validated", color: "#22C55E" },
          { name: "rejected", displayName: "Rejected", color: "#EF4444" },
        ],
      });
    }

    system.db.table("crm_partners", (table) => {
      table.sampleData({ skipSampleData: true });

      table.string("name", 255).notNull();
      if (program) {
        table.enum("partner_type", "crm_partner_type").notNull();
        table.enum("validation_status", "crm_partner_validation_status")
          .default(
            sql.lit`pending`,
          );
        table.bool("incentive_eligibility").default(sql`false`);
        table.smallUint("co_sell_readiness_score");
      }
      table.string("contact_email", 255);
      table.string("contact_phone", 50);
      table.string("notes", 2000);

      if (program) {
        // Partner performance tracking
        table.smallUint("delivery_quality_score");
        table.smallUint("responsiveness_score");
        table.smallUint("satisfaction_score");
      }

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);

      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
        ],
      });
    });

    if (!this.opts.partners?.accountPlans) return;

    // Joint account plans table
    system.db.table("crm_partner_account_plans", (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("crm_partners").notNull().onDelete("Cascade");
      table.fk("organization_id", this.#organizationsTableName!).onDelete(
        this.#organizationChildOnDelete(),
      );
      table.string("plan_summary", 2000);
      table.string("objectives", 2000);
      table.date("target_date");

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
    });
  }

  #initializePipelines() {
    const pipelines = this.opts.pipelines!.pipelines;

    for (const pipeline of pipelines) {
      if (pipeline.enableTasks !== false) this.#hasAnyPipelineTasks = true;
      if (pipeline.enableActivityLog !== false) {
        this.#hasAnyPipelineActivityLog = true;
      }
    }

    this.#createPipelineEnums();
    this.#createPipelineStageEnums();
    this.#createPipelineItemsTable();
    this.#createPipelineStageDataTable();

    if (this.#hasAnyPipelineTasks) {
      this.#createPipelineTasksTable();
    }

    if (this.#hasAnyPipelineActivityLog) {
      this.#createPipelineActivityLogTable();
    }
  }

  #createPipelineEnums() {
    const pipelines = this.opts.pipelines!.pipelines;

    const pipelineValues: HelperEnumValue[] = pipelines.map((p) => ({
      name: p.name,
      displayName: p.displayName ?? toDisplayName(p.name),
    }));

    system.enum_({
      name: this.#pipelineEnumName,
      values: pipelineValues,
    });

    system.enum_({
      name: this.#pipelineEntityTypeEnumName,
      values: [
        { name: "organization", displayName: "Organization" },
        { name: "person", displayName: "Person" },
      ],
    });

    if (this.#hasAnyPipelineActivityLog) {
      system.enum_({
        name: this.#pipelineActivityTypeEnumName,
        values: [
          { name: "item_created", displayName: "Item Created" },
          { name: "stage_changed", displayName: "Stage Changed" },
          { name: "field_updated", displayName: "Field Updated" },
          { name: "task_created", displayName: "Task Created" },
          { name: "task_completed", displayName: "Task Completed" },
          { name: "task_uncompleted", displayName: "Task Uncompleted" },
          { name: "assigned", displayName: "Assigned" },
          { name: "unassigned", displayName: "Unassigned" },
          { name: "partner_attached", displayName: "Partner Attached" },
          { name: "partner_detached", displayName: "Partner Detached" },
        ],
      });
    }
  }

  #createPipelineStageEnums() {
    const pipelines = this.opts.pipelines!.pipelines;

    for (const pipeline of pipelines) {
      const stageValues: HelperEnumValue[] = pipeline.stages.map((s) => ({
        name: s.name,
        displayName: s.displayName ?? toDisplayName(s.name),
        color: s.color,
      }));

      system.enum_({
        name: this.#getPipelineStageEnumName(pipeline.name),
        values: stageValues,
      });

      for (const stage of pipeline.stages) {
        if (stage.fields) {
          for (const field of stage.fields) {
            if (field.type === "enum" && field.enumValues && !field.enumName) {
              const enumName =
                `${this.#pipelineTablePrefix}_${pipeline.name}_${stage.name}_${field.name}`;
              system.enum_({
                name: enumName,
                values: field.enumValues,
              });
            }
          }
        }
      }
    }
  }

  #createPipelineItemsTable() {
    const { db } = system;
    const hasOpportunityFields = this.opts.pipelines?.pipelines?.some((p) =>
      p.opportunityFields
    );
    const hasPartnerAttachment = this.opts.pipelines?.pipelines?.some((p) =>
      p.enablePartnerAttachment
    );

    if (hasOpportunityFields) {
      system.enum_({
        name: "crm_risk_level",
        values: [
          { name: "low", displayName: "Low", color: "#22C55E" },
          { name: "medium", displayName: "Medium", color: "#F59E0B" },
          { name: "high", displayName: "High", color: "#EF4444" },
        ],
      });
    }

    db.table(this.#pipelineItemsTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      table.enum("pipeline_name", this.#pipelineEnumName).notNull();
      table.recordDisplayName(
        [
          "pipeline_name",
          "stage_name",
          "entity_type",
          "organization_id",
          "person_id",
          ...(hasOpportunityFields ? ["opportunity_name"] : []),
        ],
        (
          pipelineName,
          stageName,
          entityType,
          organizationId,
          personId,
          opportunityName,
        ) =>
          sql`${pipelineName} || ' · ' || coalesce(
          ${
            hasOpportunityFields
              ? sql`nullif(${opportunityName}, '')`
              : sql`cast(null as string)`
          },
          case when ${entityType} = 'organization' then ${
            system.db.tables[this.organizationsTableName]
              ? sql`(select name from db.${
                sql.ref(this.organizationsTableName)
              } where id = ${organizationId})`
              : sql`cast(null as string)`
          }
          else (select concat(first_name, ' ', last_name) from db.${
            sql.ref(this.peopleTableName)
          } where id = ${personId}) end,
          'Unlinked item') || ' (' || ${stageName} || ')'`,
      );
      table.string("stage_name", 100).notNull();

      table.enum("entity_type", this.#pipelineEntityTypeEnumName).notNull();
      if (this.#crmType === "b2b") {
        table.fk("organization_id", this.#organizationsTableName!).onDelete(
          this.#organizationChildOnDelete(),
        );
      } else {
        table.bigUint("organization_id");
      }
      table.fk("person_id", this.#peopleTableName!);

      table.ordering("stage_order").notNull().default(sql`ordering.new()`);

      table.fk("assigned_to", "sys_users");

      table.date("expected_close_date");
      table.timestampUtc("entered_pipeline_at").notNull().default(sql`now()`);
      table.timestampUtc("entered_stage_at").notNull().default(sql`now()`);

      if (hasOpportunityFields) {
        table.string("opportunity_name", 255);
        table.decimal("estimated_value", { precision: 18, scale: 2 });
        table.smallUint("probability_pct");
        table.enum("risk_level", "crm_risk_level");
        if (this.pipelines.some((p) => p.opportunityFields?.qualification)) {
          table.string("use_case_category", 255);
        }
        table.string("pain_points", 2000);
        if (this.pipelines.some((p) => p.opportunityFields?.qualification)) {
          table.bool("success_metrics_defined").default(sql`false`);
          table.smallUint("business_case_score");
          table.string("competitive_landscape", 2000);
        }
      }

      // Partner attachment
      if (hasPartnerAttachment) {
        table.fk("partner_id", "crm_partners");
        table.bool("partner_attached").default(sql`false`);
      }

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
      table.fk("created_by", "sys_users");

      table.searchConfig({
        fields: [
          { field: "pipeline_name", priority: 2 },
          { field: "stage_name", priority: 2 },
          ...(hasOpportunityFields
            ? [{ field: "opportunity_name", priority: 1 }]
            : []),
        ],
      });
    });
  }

  #createPipelineStageDataTable() {
    const { db } = system;

    db.table(this.#pipelineStageDataTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("pipeline_item_id", this.#pipelineItemsTableName).notNull()
        .onDelete("Cascade");
      table.string("stage_name", 100).notNull();
      table.string("field_name", 100).notNull();

      table.string("string_value", 10000);
      table.decimal("numeric_value", { precision: 18, scale: 4 });
      table.bool("bool_value");
      table.date("date_value");

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);

      table.unique(["pipeline_item_id", "stage_name", "field_name"]);
    });
  }

  #createPipelineTasksTable() {
    const { db } = system;

    db.table(this.#pipelineTasksTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("pipeline_item_id", this.#pipelineItemsTableName).notNull()
        .onDelete("Cascade");
      table.string("title", 255).notNull();
      table.string("description", 2000);
      table.date("due_date");
      table.bool("completed").notNull().default(sql`false`);
      table.timestampUtc("completed_at");
      table.fk("assigned_to", "sys_users");
      table.fk("completed_by", "sys_users");
      table.enum("priority", "pipeline_task_priority").default(sql.lit`medium`);

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.fk("created_by", "sys_users");
    });

    system.enum_({
      name: "pipeline_task_priority",
      values: [
        { name: "low", displayName: "Low", color: "#9CA3AF" },
        { name: "medium", displayName: "Medium", color: "#F59E0B" },
        { name: "high", displayName: "High", color: "#EF4444" },
      ],
    });
  }

  #createPipelineActivityLogTable() {
    const { db } = system;

    db.table(this.#pipelineActivityLogTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("pipeline_item_id", this.#pipelineItemsTableName).notNull()
        .onDelete("Cascade");
      table.enum("activity_type", this.#pipelineActivityTypeEnumName).notNull();

      table.string("from_stage", 100);
      table.string("to_stage", 100);

      table.string("field_name", 100);
      table.string("old_value", 1000);
      table.string("new_value", 1000);

      table.string("description", 1000);

      table.fk("sys_users").notNull();
      table.timestampUtc("created_at").notNull().default(sql`now()`);
    });
  }

  #createProjectsTable() {
    const phases = this.opts.projects!.phases;

    system.enum_({
      name: "crm_project_phase",
      values: phases.map((p) => ({
        name: p.name,
        displayName: p.displayName ?? toDisplayName(p.name),
        color: p.color,
      })),
    });

    const enableAdoption = this.opts.projects!.enableAdoptionTracking;

    system.db.table(this.#projectsTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      // Link to organization and optionally pipeline item
      table.fk("organization_id", this.#organizationsTableName!).onDelete(
        this.#organizationChildOnDelete(),
      );
      if (this.opts.pipelines?.pipelines?.length) {
        table.fk("pipeline_item_id", this.#pipelineItemsTableName).onDelete(
          "SetToNull",
        );
      }

      table.string("name", 255).notNull();
      table.date("start_date");
      table.enum("phase", "crm_project_phase").default(sql.lit(phases[0].name));

      table.string("risks_issues", 5000).multiline();

      if (enableAdoption) {
        table.string("usage_metrics", 2000).multiline().displayName(
          "Usage Metrics",
        );
        table.smallUint("training_completion").displayName(
          "Training Completion %",
        );
        table.string("champion_engagement", 2000).multiline().displayName(
          "Champion Engagement",
        );
        table.smallUint("support_tickets").displayName("Support Tickets");

        table.smallUint("adoption_score");
        table.timestampUtc("adoption_score_calculated_at");
      }

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
      table.fk("created_by", "sys_users");

      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
        ],
      });
    });

    if (this.opts.projects!.enableRaci) {
      this.#createProjectRaciTable();
    }
  }

  #createProjectRaciTable() {
    system.enum_({
      name: "crm_raci_role",
      values: [
        { name: "responsible", displayName: "Responsible", color: "#3B82F6" },
        { name: "accountable", displayName: "Accountable", color: "#8B5CF6" },
        { name: "consulted", displayName: "Consulted", color: "#10B981" },
        { name: "informed", displayName: "Informed", color: "#6B7280" },
      ],
    });

    system.db.table("crm_project_raci", (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("project_id", this.#projectsTableName).notNull().onDelete(
        "Cascade",
      );
      table.fk("pipeline_task_id", this.#pipelineTasksTableName).onDelete(
        "Cascade",
      );
      table.fk("user_id", "sys_users").notNull().onDelete("Cascade");
      table.enum("role", "crm_raci_role").notNull();

      table.timestampUtc("created_at").notNull().default(sql`now()`);

      table.unique(["project_id", "pipeline_task_id", "user_id", "role"]);
    });
  }

  #createSuccessPlansTable() {
    system.db.table(this.#successPlansTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      // Link to organization and optionally pipeline item
      table.fk("organization_id", this.#organizationsTableName!).onDelete(
        this.#organizationChildOnDelete(),
      );
      if (this.opts.pipelines?.pipelines?.length) {
        table.fk("pipeline_item_id", this.#pipelineItemsTableName).onDelete(
          "SetToNull",
        );
      }

      table.string("name", 255).notNull();

      // Adoption activities - planned activities to drive adoption
      table.string("adoption_activities", 5000).multiline();

      // Renewal tracking
      table.date("renewal_date");
      table.string("expansion_opportunities", 5000).multiline();

      // Manual health assessment (0-100), written through the assessment procedure.
      table.smallUint("health_score");
      table.timestampUtc("health_score_calculated_at");

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
      table.fk("created_by", "sys_users");

      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
        ],
      });
    });

    // Create KPIs table for success plan metrics tracking
    this.#createSuccessPlanKpisTable();
  }

  #createSuccessPlanKpisTable() {
    system.db.table("crm_success_plan_kpis", (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("success_plan_id", this.#successPlansTableName).notNull()
        .onDelete("Cascade");
      table.string("name", 255).notNull();
      table.string("description", 1000);
      table.string("unit", 50);
      table.decimal("target_value", { precision: 18, scale: 4 });
      table.decimal("baseline_value", { precision: 18, scale: 4 });
      table.decimal("current_value", { precision: 18, scale: 4 });
      table.smallUint("sort_order").notNull().default(sql`0`);

      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);
    });
  }

  #createKnowledgeHubTable() {
    const itemTypes = this.opts.knowledgeHub!.itemTypes;

    system.enum_({
      name: "crm_knowledge_item_type",
      values: itemTypes.map((t) => ({
        name: t.name,
        displayName: t.displayName ?? toDisplayName(t.name),
        color: t.color,
      })),
    });

    system.db.table(this.#knowledgeHubTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("organization_id", this.#organizationsTableName!).onDelete(
        this.#organizationChildOnDelete(),
      );
      if (this.opts.pipelines?.pipelines?.length) {
        table.fk("pipeline_item_id", this.#pipelineItemsTableName).onDelete(
          "SetToNull",
        );
      }

      table.enum("item_type", "crm_knowledge_item_type").notNull();
      table.string("title", 255).notNull();
      table.string("content", 50000).multiline();

      table.fk("created_by", "sys_users").notNull();
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.timestampUtc("last_modified_at").notNull().default(sql`now()`);

      table.searchConfig({
        fields: [
          { field: "title", priority: 1 },
          { field: "content", priority: 2 },
        ],
      });
      table.addBlock(AttachmentsTableBlock);
    });
  }

  /** Creates notification storage when partner automation is explicitly registered. */
  ensurePartnerNotificationsTable() {
    if (system.db.tables[this.#partnerNotificationsTableName]) return;
    system.enum_({
      name: "crm_partner_notification_type",
      values: [
        { name: "co_sell_ready", displayName: "Co-Sell Ready" },
        { name: "validation_required", displayName: "Validation Required" },
        { name: "deal_attached", displayName: "Deal Attached" },
      ],
    });

    system.db.table(this.#partnerNotificationsTableName, (table) => {
      table.sampleData({ skipSampleData: true });

      table.fk("pipeline_item_id", this.#pipelineItemsTableName).notNull()
        .onDelete("Cascade");
      table.fk("partner_id", "crm_partners").notNull().onDelete("Cascade");
      table.enum("notification_type", "crm_partner_notification_type")
        .notNull();

      table.timestampUtc("notified_at").notNull().default(sql`now()`);
      table.timestampUtc("acknowledged_at");
      table.fk("acknowledged_by", "sys_users");

      table.unique(["pipeline_item_id", "notification_type"]);
    });
  }

  #getPipelineStageEnumName(pipelineName: string): string {
    return `${this.#pipelineTablePrefix}_${pipelineName}_stage`;
  }

  get crmType() {
    return this.#crmType;
  }

  get organizationsTableName() {
    return this.#organizationsTableName!;
  }

  get peopleTableName() {
    return this.#peopleTableName!;
  }

  /**
   * Adds the CRM record foreign keys required by `commentSection` to a shared
   * CommentsBlock thread table.
   */
  defineCommentThreadFields(table: TableBuilder) {
    if (this.opts.organizations?.commentSection) {
      table.fk(
        `${singularize(this.organizationsTableName)}_id`,
        this.organizationsTableName,
      ).onDelete("Cascade");
    }
    if (this.opts.people?.commentSection) {
      table.fk(
        `${singularize(this.peopleTableName)}_id`,
        this.peopleTableName,
      ).onDelete("Cascade");
    }
  }

  /** Context adapter for CRM discussions, including standalone permalinks. */
  commentDiscussion(opts: {
    domain: string;
    canRead: (table: string, recordId: Sql, userId: Sql) => Sql;
    canWrite: (table: string, recordId: Sql, userId: Sql) => Sql;
  }): CommentDiscussion {
    const tables = [
      ...(this.opts.organizations?.commentSection
        ? [this.organizationsTableName]
        : []),
      ...(this.opts.people?.commentSection ? [this.peopleTableName] : []),
    ];
    const recordId = (thread: Sql, table: string) =>
      sql`${thread}.${sql.ref(`${singularize(table)}_id`)}`;
    return {
      canRead: (thread, userId) =>
        sql`${
          sql.or(tables.map((table) =>
            sql`exists (
        select 1 from db.${sql.ref(table)} where id = ${recordId(thread, table)}
          and ${opts.canRead(table, recordId(thread, table), userId)})`
          ))
        }`,
      canWrite: (thread, userId) =>
        sql`${
          sql.or(tables.map((table) =>
            sql`${recordId(thread, table)} is not null
        and ${opts.canWrite(table, recordId(thread, table), userId)}`
          ))
        }`,
      label: (thread) =>
        sql.caseWhen({
          conditions: tables.map((table) => ({
            condition: sql`${recordId(thread, table)} is not null`,
            expr: sql`(select ${
              system.db.tables[table].getRecordDisplayNameExpr(sql`subject`)
            }
          from db.${sql.ref(table)} subject where subject.id = ${
              recordId(thread, table)
            })`,
          })),
          default: sql.lit`Discussion`,
        }),
      parentHref: (thread) =>
        notificationAppHref(
          opts.domain,
          sql.caseWhen({
            conditions: tables.map((table) => ({
              condition: sql`${recordId(thread, table)} is not null`,
              expr: table === this.organizationsTableName
                ? this.organizationHref(recordId(thread, table))
                : this.personHref(recordId(thread, table)),
            })),
            default: sql`null`,
          }),
        ),
    };
  }

  get organizationFieldGroups() {
    return this.#organizationFieldGroups;
  }

  get peopleFieldGroups() {
    return this.#peopleFieldGroups;
  }

  get pipelineItemsTableName() {
    return this.#pipelineItemsTableName;
  }

  get pipelineStageDataTableName() {
    return this.#pipelineStageDataTableName;
  }

  get pipelineTasksTableName() {
    return this.#pipelineTasksTableName;
  }

  get pipelineActivityLogTableName() {
    return this.#pipelineActivityLogTableName;
  }

  get pipelineItemFkColumnName() {
    return "pipeline_item_id";
  }

  get pipelineEnumName() {
    return this.#pipelineEnumName;
  }

  get pipelineEntityTypeEnumName() {
    return this.#pipelineEntityTypeEnumName;
  }

  get pipelines(): PipelineConfig[] {
    return this.opts.pipelines?.pipelines ?? [];
  }

  get projectsTableName() {
    return this.#projectsTableName;
  }

  get successPlansTableName() {
    return this.#successPlansTableName;
  }

  get knowledgeHubTableName() {
    return this.#knowledgeHubTableName;
  }

  get partnerNotificationsTableName() {
    return this.#partnerNotificationsTableName;
  }

  get routes() {
    return this.#routes;
  }

  get organizationRelationshipStateConfig() {
    return this.opts.organizationRelationshipState;
  }

  get organizationRelationshipDispositionEnumName() {
    return this.opts.organizationRelationshipState?.disposition.enumName ??
      "crm_relationship_disposition";
  }

  get organizationRelationshipDispositionFieldName() {
    return this.opts.organizationRelationshipState?.disposition.fieldName ??
      "relationship_disposition";
  }

  get organizationRelationshipSnoozeUntilFieldName() {
    return this.opts.organizationRelationshipState?.snooze?.untilFieldName ??
      "relationship_snoozed_until";
  }

  get organizationRelationshipSnoozeReasonFieldName() {
    const reasonFieldName = this.opts.organizationRelationshipState?.snooze
      ?.reasonFieldName;
    return reasonFieldName === false
      ? "relationship_snooze_reason"
      : reasonFieldName ?? "relationship_snooze_reason";
  }

  clearOrganizationRelationshipSnooze(
    s: CrmDebugHookStatements,
    organizationId: NumericExpr,
    extraWhere?: Sql,
  ) {
    const relationshipState = this.opts.organizationRelationshipState;
    if (!relationshipState?.snooze) return;

    const reasonAssignment = relationshipState.snooze.reasonFieldName === false
      ? sql``
      : sql`, ${
        sql.ref(this.organizationRelationshipSnoozeReasonFieldName)
      } = null`;
    const extraCondition = extraWhere ? sql`and (${extraWhere})` : sql``;

    s.modify(sql`
      update db.${sql.ref(this.organizationsTableName)}
      set
        ${sql.ref(this.organizationRelationshipSnoozeUntilFieldName)} = null
        ${reasonAssignment}
      where id = ${organizationId}
        ${extraCondition}
    `);
  }

  /**
   * Builds a navigable URL for a record by substituting `id` into the
   * `{record_id:id}` placeholder of `path`, or appending it when the path has
   * no placeholder. Used by the typed `*Href` helpers below.
   */
  recordHref(path: string, id: NumericExpr) {
    const placeholder = "{record_id:id}";
    const placeholderIndex = path.indexOf(placeholder);
    if (placeholderIndex === -1) {
      return sql.concat(sql.lit(path.endsWith("/") ? path : `${path}/`), id);
    }
    return sql.concat(
      sql.lit(path.slice(0, placeholderIndex)),
      id,
      sql.lit(path.slice(placeholderIndex + placeholder.length)),
    );
  }

  organizationHref(id: NumericExpr) {
    return this.recordHref(this.#routes.organizationDetailPath, id);
  }

  personHref(id: NumericExpr) {
    return this.recordHref(this.#routes.personDetailPath, id);
  }

  pipelineItemHref(id: NumericExpr) {
    return this.recordHref(this.#routes.pipelineItemDetailPath, id);
  }

  projectHref(id: NumericExpr) {
    return this.recordHref(this.#routes.projectDetailPath, id);
  }

  successPlanHref(id: NumericExpr) {
    return this.recordHref(this.#routes.successPlanDetailPath, id);
  }

  knowledgeHubItemHref(id: NumericExpr) {
    return this.recordHref(this.#routes.knowledgeHubDetailPath, id);
  }

  emailDraftHref(id: NumericExpr) {
    return this.recordHref(this.#routes.emailDraftDetailPath, id);
  }

  hasProjectsEnabled(): boolean {
    return this.opts.projects?.enabled === true;
  }

  hasEmailDraftsEnabled(): boolean {
    return this.opts.emailDrafts?.enabled === true;
  }

  hasSuccessPlansEnabled(): boolean {
    return this.opts.successPlans?.enabled === true;
  }

  hasKnowledgeHubEnabled(): boolean {
    return this.opts.knowledgeHub?.enabled === true;
  }

  get projectPhases(): Array<
    { name: string; displayName?: string; color?: string }
  > {
    return this.opts.projects!.phases;
  }

  hasRaciEnabled(): boolean {
    return this.opts.projects?.enabled === true &&
      this.opts.projects.enableRaci;
  }

  hasAdoptionTrackingEnabled(): boolean {
    return this.opts.projects?.enabled === true &&
      this.opts.projects.enableAdoptionTracking;
  }

  get knowledgeHubItemTypes(): Array<
    { name: string; displayName?: string; color?: string; icon?: IconName }
  > {
    return this.opts.knowledgeHub!.itemTypes;
  }

  get healthScoreThresholds(): { good: number; warning: number } {
    return this.opts.successPlans!.healthScoreThresholds;
  }

  get renewalUpcomingDays(): number {
    return this.opts.successPlans!.renewalUpcomingDays;
  }

  getPipelineStageEnumName(pipelineName: string) {
    return this.#getPipelineStageEnumName(pipelineName);
  }

  getPipeline(name: string): PipelineConfig | undefined {
    return this.opts.pipelines?.pipelines?.find((p) => p.name === name);
  }

  getPipelineStage(
    pipelineName: string,
    stageName: string,
  ): PipelineStageConfig | undefined {
    const pipeline = this.getPipeline(pipelineName);
    return pipeline?.stages.find((s) => s.name === stageName);
  }

  getPipelineStageFields(
    pipelineName: string,
    stageName: string,
  ): PipelineStageFieldConfig[] {
    const stage = this.getPipelineStage(pipelineName, stageName);
    return stage?.fields ?? [];
  }

  /** The stage immediately after `currentStageName` in the pipeline's configured
   * stage order, or undefined if it is the last/unknown stage. */
  getNextPipelineStage(
    pipelineName: string,
    currentStageName: string,
  ): PipelineStageConfig | undefined {
    const pipeline = this.getPipeline(pipelineName);
    if (!pipeline) return undefined;

    const currentIndex = pipeline.stages.findIndex((s) =>
      s.name === currentStageName
    );
    if (currentIndex === -1 || currentIndex >= pipeline.stages.length - 1) {
      return undefined;
    }

    return pipeline.stages[currentIndex + 1];
  }

  /** The stage immediately before `currentStageName` in the pipeline's configured
   * stage order, or undefined if it is the first/unknown stage. */
  getPreviousPipelineStage(
    pipelineName: string,
    currentStageName: string,
  ): PipelineStageConfig | undefined {
    const pipeline = this.getPipeline(pipelineName);
    if (!pipeline) return undefined;

    const currentIndex = pipeline.stages.findIndex((s) =>
      s.name === currentStageName
    );
    if (currentIndex <= 0) {
      return undefined;
    }

    return pipeline.stages[currentIndex - 1];
  }

  /** Whether an item belongs to a pipeline whose task capability is enabled. */
  pipelineItemSupportsTasks(itemId: NumericExpr): Sql {
    const pipelines = this.pipelines.filter((p) =>
      this.hasPipelineTasksEnabled(p.name)
    );
    return pipelines.length
      ? sql`exists (
      select 1 from db.${sql.ref(this.pipelineItemsTableName)} task_item
      where task_item.id = ${itemId} and ${
        sql.or(
          ...pipelines.map((p) =>
            sql`task_item.pipeline_name = ${sql.lit(p.name)}`
          ),
        )
      }
    )`
      : sql`false`;
  }

  hasPipelineTasksEnabled(pipelineName: string): boolean {
    const pipeline = this.getPipeline(pipelineName);
    return !!pipeline && pipeline.enableTasks !== false;
  }

  hasPipelineActivityLogEnabled(pipelineName: string): boolean {
    const pipeline = this.getPipeline(pipelineName);
    return !!pipeline && pipeline.enableActivityLog !== false;
  }

  /** Block lifecycle hook: seeds the `crm_industries` lookup table (if present)
   * before sample data is generated. */
  beforeGenerateSampleData(
    s: IServerBaseStatements,
    ctx: SampleDataScriptContext,
  ) {
    s.startTransaction();
    if (system.db.tables.crm_industries) {
      s.modify(
        sql`insert into crm_industries (name) values ('Technology'), ('Healthcare'), ('Finance'), ('Manufacturing'), ('Retail'), ('Other')`,
      );
      ctx.incrementRecordCount("crm_industries", 6);
    }
    s.commitTransaction();
  }

  /** Self-routing detail page for a single organization. */
  static get OrganizationDetailPage() {
    return OrganizationDetailPage;
  }
  /** Route-less detail content for an organization inside an existing record route. */
  static get OrganizationDetailContent() {
    return OrganizationDetailContent;
  }
  /** Self-routing detail page for a single person/contact. */
  static get PersonDetailPage() {
    return PersonDetailPage;
  }
  /** Route-less detail content for a person/contact inside an existing record route. */
  static get PersonDetailContent() {
    return PersonDetailContent;
  }
  /**
   * Component that mounts every default CRM route enabled by the block's opts
   * (lists, detail pages, pipelines, projects, success plans, knowledge hub,
   * inbox). Pass `overrides` to replace or suppress individual routes.
   */
  static get StandardRoutes() {
    return CrmStandardRoutes;
  }
  /**
   * Inline-editable label/icon row for an organization or person field.
   * Use inside the `details` prop of `OrganizationDetailPage` or
   * `PersonDetailPage` to compose a custom details panel.
   */
  static get DetailField() {
    return EditSimpleField;
  }
  /**
   * Display-only label/icon row that wraps arbitrary content (e.g. an
   * `AddressText`). Pair with `DetailField` to compose a custom details
   * panel.
   */
  static get DetailDisplayField() {
    return DetailFieldDisplayOnly;
  }

  /** Prebuilt overview report components for the core CRM entities. */
  static Reports = {
    get OrganizationsOverview() {
      return ({ name }: { name?: string }) => {
        const block = system.block(CrmBlock);
        return block.crmType === "b2b"
          ? <OrganizationsOverviewReport name={name} />
          : null;
      };
    },
    get PeopleOverview() {
      return PeopleOverviewReport;
    },
    ProjectsOverview: ({ name }: { name?: string }) => {
      const block = system.block(CrmBlock);
      return (
        <KanbanProjectTableBlock.Reports.ProjectsOverview
          name={name}
          table={block.organizationsTableName}
        />
      );
    },
    WelcomeBack: WelcomeBackReport,
  };

  /**
   * Pipeline UI building blocks, report components, and the imperative
   * helpers (`addToPipeline`, `removeFromPipeline`, `createAutoTasksForStage`)
   * for composing custom pipeline pages.
   */
  static Pipeline = {
    Board: PipelineBoard,
    ItemDetailPage: PipelineItemDetailPage,
    StageFieldsForm: StageFieldsForm,
    ExitCriteriaChecklist: ExitCriteriaChecklist,
    TaskList: PipelineTaskList,
    OverdueTasksAlert: OverdueTasksAlert,
    Pages: PipelinePages,
    Reports: {
      Overview: PipelineOverviewReport,
      Tasks: PipelineTasksReport,
      SalesDashboard: SalesDashboard,
      AdoptionValue: AdoptionValueDashboard,
      OperatingRhythm: OperatingRhythmDashboard,
      PartnerMetrics: PartnerMetricsDashboard,
      RYGScorecards: RYGScorecards,
      QualificationScoreDistribution: QualificationScoreDistribution,
    },
    addToPipeline: addToPipeline,
    removeFromPipeline: removeFromPipeline,
    createAutoTasksForStage: createAutoTasksForStage,
    EntityStatusTab: EntityPipelineStatusTab,
    /** Form component for extended pipeline item fields (value, probability, etc.) */
    ExtendedItemFieldsForm: ExtendedItemFieldsForm,
    /** Card component for displaying/editing extended item details */
    ExtendedItemDetailsCard: ExtendedItemDetailsCard,
    /** Helper to get extended field values from Write state */
    getExtendedItemFieldsFromWriteState: getExtendedItemFieldsFromWriteState,
  };

  /** Page components for project tracking; requires `projects.enabled`. */
  static Projects = {
    ListPage: ProjectListPage,
    DetailPage: ProjectDetailPage,
    NewPage: ProjectNewPage,
    OrganizationTab: ProjectOrganizationTab,
  };

  /** Page components for success plans; requires `successPlans.enabled`. */
  static SuccessPlans = {
    ListPage: SuccessPlanListPage,
    DetailPage: SuccessPlanDetailPage,
    NewPage: SuccessPlanNewPage,
  };

  /** Page components for the knowledge hub; requires `knowledgeHub.enabled`. */
  static KnowledgeHub = {
    Page: KnowledgeHubPage,
    DetailPage: KnowledgeItemDetailPage,
    NewPage: KnowledgeItemNewPage,
    OrganizationTab: KnowledgeHubOrganizationTab,
  };
}

function relationshipDispositionEmojiSql(
  disposition: Sql,
  values: CrmRelationshipDispositionValue[],
  enumName: string,
) {
  let expression = sql`case`;
  let hasEmoji = false;
  for (const value of values) {
    if (!value.emoji) continue;
    hasEmoji = true;
    expression = sql`${expression}
      when ${disposition} = ${sql.lit(value.name)}::enums.${sql.ref(enumName)}
      then ${sql.lit(`${value.emoji} `)}
    `;
  }
  return hasEmoji ? sql`${expression} else '' end` : sql.lit``;
}

export function CrmRelationshipDispositionChip(
  props: { disposition: Sql; className?: string },
) {
  const block = system.block(CrmBlock);
  const relationshipState = block.organizationRelationshipStateConfig;
  const baseClassName = props.className ??
    "inline-flex items-center rounded-full border border-divider bg-level1 px-2 py-0.5 text-xs font-medium text-secondary";

  if (!relationshipState) {
    return (
      <span className={baseClassName}>
        {sql`coalesce(cast(${props.disposition} as string), 'No disposition')`}
      </span>
    );
  }

  const enumName = block.organizationRelationshipDispositionEnumName;
  const displayFnName = `display_${enumName}`;
  const disposition = sql`try_cast(${props.disposition} as enums.${
    sql.ref(enumName)
  })`;
  const emoji = relationshipDispositionEmojiSql(
    disposition,
    relationshipState.disposition.values,
    enumName,
  );

  return (
    <span
      className={baseClassName}
      dynamicClassNames={relationshipState.disposition.values
        .filter((value) => value.chipClassNames)
        .map((value) => ({
          condition: sql`${disposition} = ${sql.lit(value.name)}::enums.${
            sql.ref(enumName)
          }`,
          classNames: value.chipClassNames!,
        }))}
    >
      {sql`
        case
          when ${disposition} is null then 'No disposition'
          else ${emoji} || fn.${sql.ref(displayFnName)}(${disposition})
        end
      `}
    </span>
  );
}

export function CrmRelationshipDispositionGridCell(
  props: { editable?: boolean },
) {
  const helper = useCellHelper();
  const block = system.block(CrmBlock);
  const relationshipState = block.organizationRelationshipStateConfig;

  if (!relationshipState) {
    return <CrmRelationshipDispositionChip disposition={helper.value} />;
  }

  const enumName = block.organizationRelationshipDispositionEnumName;
  const disposition = sql`try_cast(${helper.value} as enums.${
    sql.ref(enumName)
  })`;

  if (props.editable === false) {
    return <CrmRelationshipDispositionChip disposition={disposition} />;
  }

  const handlers = helper.fieldEditorEventHandlers({
    tableName: block.organizationsTableName,
    fieldName: block.organizationRelationshipDispositionFieldName,
    dbValue: sql`value`,
    validUiValue: true,
    changedUiValue: sql`
      case
        when ${disposition} is null then value is not null
        else value is null or ${disposition} != value
      end
    `,
  });

  return (
    <Show
      when={helper.editing}
      fallback={<CrmRelationshipDispositionChip disposition={disposition} />}
    >
      <State procedure={(s) => s.defScalar("value", disposition)}>
        <select
          className="h-full w-full rounded border border-divider bg-level1 px-2 py-1 text-sm text-primary outline-none"
          value={sql`value`}
          yolmFocusKey
          {...handlers}
          onInput={(s) => {
            s.setScalar(
              "ui.value",
              sql`try_cast(nullif(target_value, '') as enums.${
                sql.ref(enumName)
              })`,
            );
          }}
        >
          <option value="">No value</option>
          {relationshipState.disposition.values
            .filter((value) => !value.hideFromUi)
            .map((value) => (
              <option value={value.name}>
                {value.displayName ?? value.name.replaceAll("_", " ")}
              </option>
            ))}
        </select>
      </State>
    </Show>
  );
}

export function clearCrmOrganizationRelationshipSnooze(
  s: CrmDebugHookStatements,
  organizationId: NumericExpr,
  extraWhere?: Sql,
) {
  system.block(CrmBlock).clearOrganizationRelationshipSnooze(
    s,
    organizationId,
    extraWhere,
  );
}

function renderStandardRouteContent(
  override: StandardRouteOverride | undefined,
  fallback: Node,
) {
  if (override === false) return null;
  if (override !== undefined) return override;
  return fallback;
}

function StandardDatagridList(props: {
  table: string;
  path: string;
  datagridName?: string;
  addLabel: string;
  merge?: boolean;
}) {
  return (
    <DatagridPage
      table={props.table}
      path={props.path}
      datagridName={props.datagridName}
      bulk={props.merge ? { merge: true } : undefined}
      toolbarRight={
        <AutoInsertButton size="sm" startIcon="Add">
          {props.addLabel}
        </AutoInsertButton>
      }
    />
  );
}

function StandardPipelineRoutes(props: { block: CrmBlock }) {
  const { block } = props;
  const pipeline = block.pipelines.length === 1 ? block.pipelines[0] : null;
  const routes = block.routes;

  if (pipeline) {
    return (
      <>
        <Route path={routes.pipelinesPath}>
          <div className="p-4">
            <PipelineBoard
              pipelineName={pipeline.name}
              onItemClick={(s, itemId) => {
                s.navigate(block.pipelineItemHref(itemId));
              }}
              header={
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <MaterialIcon
                      icon={pipeline.icon ?? "ViewKanban"}
                      className="text-2xl text-primary-500"
                    />
                    <Typography level="h3">
                      {pipeline.displayName ?? toDisplayName(pipeline.name)}
                    </Typography>
                  </div>
                  <OverdueTasksAlert pipelineName={pipeline.name} limit={3} />
                </div>
              }
            />
          </div>
        </Route>
        <Route path={`${routes.pipelinesPath}/reports`}>
          <div className="p-6">
            <PipelineOverviewReport pipelineName={pipeline.name} />
          </div>
        </Route>
      </>
    );
  }

  return <PipelinePages basePath={routes.pipelinesPath} />;
}

function CrmStandardRoutes(props: CrmStandardRoutesProps) {
  const block = system.block(CrmBlock);
  const routes = block.routes;
  const overrides = props.overrides ?? {};
  const integrations = block.opts.emailIntegrations ?? [];
  const hasIndustriesTable = !!system.db.tables.crm_industries;
  const hasPartnersTable = !!system.db.tables.crm_partners;
  const inboxOwnerConditions: BooleanExpr[] = [];
  for (const integration of integrations) {
    if (integration.integration === GmailIntegration) {
      inboxOwnerConditions.push(sql`exists (
        select 1
        from db.user_gmail_accounts account
        where account.id = user_gmail_account_id
          and account.sys_user_id = current_user
      )`);
    }
    if (integration.integration === OutlookEmailIntegration) {
      inboxOwnerConditions.push(sql`exists (
        select 1
        from db.user_outlook_emails_accounts account
        where account.id = user_outlook_emails_account_id
          and account.sys_user_id = current_user
      )`);
    }
  }
  const inboxWhere = inboxOwnerConditions.length > 0
    ? sql.or(...inboxOwnerConditions)
    : sql`false`;

  return (
    <>
      {block.crmType === "b2b" &&
        renderStandardRouteContent(
          overrides.organizationsList,
          <StandardDatagridList
            table={block.organizationsTableName}
            path={routes.organizationsListPath}
            datagridName={routes.organizationsDatagridName}
            addLabel={`Add ${
              singularize(
                system.db.tables[block.organizationsTableName].displayName,
              )
            }`}
            merge
          />,
        )}
      {block.crmType === "b2b" &&
        renderStandardRouteContent(
          overrides.organizationDetail,
          <OrganizationDetailPage path={routes.organizationDetailPath} />,
        )}
      {renderStandardRouteContent(
        overrides.peopleList,
        <StandardDatagridList
          table={block.peopleTableName}
          path={routes.peopleListPath}
          datagridName={routes.peopleDatagridName}
          addLabel={`Add ${
            singularize(system.db.tables[block.peopleTableName].displayName)
          }`}
          merge
        />,
      )}
      {renderStandardRouteContent(
        overrides.personDetail,
        <PersonDetailPage path={routes.personDetailPath} />,
      )}
      {block.pipelines.length > 0 &&
        renderStandardRouteContent(
          overrides.pipelines,
          <StandardPipelineRoutes block={block} />,
        )}
      {block.pipelines.length > 0 &&
        renderStandardRouteContent(
          overrides.pipelineItemDetail,
          <PipelineItemDetailPage
            pipelineName={block.pipelines.length === 1
              ? block.pipelines[0].name
              : undefined}
            path={routes.pipelineItemDetailPath}
          />,
        )}
      {block.hasProjectsEnabled() &&
        renderStandardRouteContent(
          overrides.projectsList,
          <ProjectListPage path={routes.projectsListPath} />,
        )}
      {block.hasProjectsEnabled() &&
        renderStandardRouteContent(
          overrides.projectDetail,
          <ProjectDetailPage path={routes.projectDetailPath} />,
        )}
      {block.hasProjectsEnabled() &&
        renderStandardRouteContent(
          overrides.projectNew,
          <ProjectNewPage path={routes.projectNewPath} />,
        )}
      {block.hasSuccessPlansEnabled() &&
        renderStandardRouteContent(
          overrides.successPlansList,
          <SuccessPlanListPage path={routes.successPlansListPath} />,
        )}
      {block.hasSuccessPlansEnabled() &&
        renderStandardRouteContent(
          overrides.successPlanDetail,
          <SuccessPlanDetailPage path={routes.successPlanDetailPath} />,
        )}
      {block.hasSuccessPlansEnabled() &&
        renderStandardRouteContent(
          overrides.successPlanNew,
          <SuccessPlanNewPage path={routes.successPlanNewPath} />,
        )}
      {block.hasKnowledgeHubEnabled() &&
        renderStandardRouteContent(
          overrides.knowledgeHubList,
          <KnowledgeHubPage path={routes.knowledgeHubListPath} />,
        )}
      {block.hasKnowledgeHubEnabled() &&
        renderStandardRouteContent(
          overrides.knowledgeHubDetail,
          <KnowledgeItemDetailPage path={routes.knowledgeHubDetailPath} />,
        )}
      {block.hasKnowledgeHubEnabled() &&
        renderStandardRouteContent(
          overrides.knowledgeHubNew,
          <KnowledgeItemNewPage path={routes.knowledgeHubNewPath} />,
        )}
      {hasPartnersTable &&
        renderStandardRouteContent(
          overrides.partnersList,
          <StandardDatagridList
            table="crm_partners"
            path={routes.partnersListPath}
            addLabel="Add Partner"
          />,
        )}
      {hasIndustriesTable &&
        renderStandardRouteContent(
          overrides.industriesList,
          <StandardDatagridList
            table="crm_industries"
            path={routes.industriesListPath}
            addLabel="Add Industry"
          />,
        )}
      {integrations.length > 0 &&
        renderStandardRouteContent(
          overrides.inbox,
          (
            <Route path={routes.inboxPath}>
              <AllEmailsList
                where={inboxWhere}
                enableDraftSaving={block.hasEmailDraftsEnabled() &&
                  overrides.emailDrafts !== false}
              />
            </Route>
          ),
        )}
      {integrations.length > 0 && block.hasEmailDraftsEnabled() &&
        renderStandardRouteContent(
          overrides.emailDrafts,
          <EmailDraftRoutes />,
        )}
      {integrations.length > 0 &&
        renderStandardRouteContent(
          overrides.emailIntegrations,
          (
            <EmailIntegrationsPage
              integrations={integrations}
              path={routes.emailIntegrationsPath}
            />
          ),
        )}
    </>
  );
}

/**
 * High-level shape of the CRM. `b2b` adds organizations + the
 * person↔organization relationship; `b2c` keeps only the people table.
 */
export type CRMType = "b2b" | "b2c";

/**
 * How deleting an organization treats its CRM-owned child records. `emptyOnly`
 * blocks deletion while related records exist (`Restrict`); `direct` cascades
 * the delete to children (`Cascade`).
 */
export type CrmOrganizationDeletionMode = "emptyOnly" | "direct";

/** A configured relationship disposition shown on an organization/account. */
export interface CrmRelationshipDispositionValue extends HelperEnumValue {
  /** Optional visual marker rendered before the disposition label. */
  emoji?: string;
  /** Optional CSS classes for the generated disposition chip. */
  chipClassNames?: string;
}

/** Configures lightweight account relationship state owned by CrmBlock. */
export interface CrmOrganizationRelationshipStateConfig {
  disposition: {
    /** Enum name to generate. Defaults to `crm_relationship_disposition`. */
    enumName?: string;
    /** Organization field name. Defaults to `relationship_disposition`. */
    fieldName?: string;
    /** Field display name. Defaults to `Disposition`. */
    displayName?: string;
    values: CrmRelationshipDispositionValue[];
  };
  snooze?: {
    /** Organization date field name. Defaults to `relationship_snoozed_until`. */
    untilFieldName?: string;
    /**
     * Optional text field for explaining the snooze. Defaults to
     * `relationship_snooze_reason`; pass `false` to skip it.
     */
    reasonFieldName?: string | false;
    /** Max length for the reason field. Defaults to 500. */
    reasonMaxLength?: number;
  };
}

/**
 * Options for {@link CrmBlock}. Defines the core CRM shape (`type`),
 * declares the people/organization tables and their custom fields, and
 * optionally enables pipelines, projects, success plans, knowledge hub,
 * and email-campaign integrations.
 */
export interface CrmBlockOpts {
  /** CRM shape; defaults to `"b2b"`. See {@link CRMType}. */
  type?: CRMType;
  /** Default country for phone-number fields the block creates. */
  phoneCountry?: string;
  /**
   * Optional account relationship state: a configured organization disposition
   * enum plus snooze fields. Apps decide how to query and surface this state.
   */
  organizationRelationshipState?: CrmOrganizationRelationshipStateConfig;
  /** Configuration for the people/contacts table (always created). */
  people: {
    tableName: string;
    /** Callback to add custom fields; receives a {@link PeopleConfig} helper. */
    define?: (table: TableBuilder, config: PeopleConfig) => void;
    /** B2C only: add birth date, gender, address, contact preference. Defaults to true. */
    addDefaultB2CFields?: boolean;
    /** Skip the built-in first/last name, email, phone fields. */
    disableDefaultFields?: boolean;
    /** Whether `first_name` is required; defaults to true. */
    defaultFieldsRequired?: boolean;
    fieldGroups?: Array<{
      name: string;
      displayLocation?: "tab" | "details";
      icon?: IconName;
      displayName?: string;
      define: (fg: FieldGroupBuilder) => void;
    }>;
    /** Show the configured CommentsBlock for each people record. */
    commentSection?: boolean;
    /** Prefix applied to field-group column names. */
    fieldGroupPrefix?: string;
  };

  /** Configuration for the organizations table (B2B only by default). */
  organizations?: {
    tableName: string;
    /** Callback to add custom fields; receives an {@link OrganizationConfig} helper. */
    define?: (table: TableBuilder, config: OrganizationConfig) => void;
    /** Force-create the table; in B2C the org table is opt-in, in B2B opt-out. */
    createTable?: boolean;
    deletion?: {
      /**
       * Defaults to `"emptyOnly"`, which uses `Restrict` for CRM-owned
       * organization relationships and explains blocking related records in
       * the organization delete dialog.
       */
      mode?: CrmOrganizationDeletionMode;
    };
    fieldGroups?: Array<{
      name: string;
      displayLocation?: "tab" | "details";
      icon?: IconName;
      displayName?: string;
      define: (fg: FieldGroupBuilder) => void;
    }>;
    /** Show the configured CommentsBlock for each organization record. */
    commentSection?: boolean;
    /** Prefix applied to field-group column names. */
    fieldGroupPrefix?: string;
  };
  /** Email provider integrations; enabling any creates the email tables. */
  emailIntegrations?: EmailIntegrationConfig[];
  /** Enables application-owned draft schema and standard draft routes. */
  emailDrafts?: {
    enabled?: boolean;
  };

  /** Sales/CS pipelines (kanban boards) and their backing tables. */
  pipelines?: {
    pipelines: PipelineConfig[];
    /** Table-name prefix for all pipeline tables; defaults to `"crm_pipeline"`. */
    tablePrefix?: string;
  };

  /** Optional partner-program schema beyond basic partner names and contact details. */
  partners?: {
    program?: { coSellReadinessThreshold: number };
    /** Joint account plans; independent of program fields and notification automation. */
    accountPlans?: boolean;
  };

  /** Project tracking (phases, milestones, optional RACI and adoption). */
  projects?: {
    enabled?: boolean;
    tableName?: string;
    /** Ordered project phases; the first is the default and an enum is generated. */
    phases: Array<{ name: string; displayName?: string; color?: string }>;
    /** Create the responsible/accountable/consulted/informed assignment table. */
    enableRaci: boolean;
    /** Add adoption-metric fields and the adoption score column. */
    enableAdoptionTracking: boolean;
  };

  /** Customer-success plans with KPIs, renewal tracking, and health score. */
  successPlans?: {
    enabled?: boolean;
    tableName?: string;
    /** Health-score cutoffs (0-100) used by scorecards to color good/warning/bad. */
    healthScoreThresholds: { good: number; warning: number };
    /** Window (in days) within which a renewal counts as upcoming. */
    renewalUpcomingDays: number;
  };

  /** Per-organization knowledge base of typed items (notes, docs, links). */
  knowledgeHub?: {
    enabled?: boolean;
    tableName?: string;
    /** Item-type taxonomy; generates the knowledge-item-type enum. */
    itemTypes: Array<
      { name: string; displayName?: string; color?: string; icon?: IconName }
    >;
  };

  routes?: CrmRouteConfig;
  automations?: CrmAutomationConfig;
  debugHooks?: CrmDebugHooks;
}

/**
 * Helper passed to the user's `organizations.define(table, config)`
 * callback. Adds standardized fields (status, industry, region, size,
 * tier) and the matching enums via the `standard*` methods, leaving the
 * caller free to mix in custom fields.
 */
export class OrganizationConfig {
  constructor(private table: TableBuilder) {}

  /** Add a lifecycle `status` enum (lead/prospect/customer/churned/inactive). */
  standardStatus() {
    system.enum_({
      name: "organization_status",
      values: [
        { name: "lead", displayName: "Lead", color: "#FFA500" },
        { name: "prospect", displayName: "Prospect", color: "#FFD700" },
        { name: "customer", displayName: "Customer", color: "#32CD32" },
        { name: "churned", displayName: "Churned", color: "#DC143C" },
        { name: "inactive", displayName: "Inactive", color: "#808080" },
      ],
    });
    this.table.enum("status", "organization_status").notNull();
  }

  /** Add an `industry` enum column with a fixed set of industries. */
  standardEnumIndustry() {
    system.enum_({
      name: "crm_industry",
      values: [
        { name: "technology", displayName: "Technology" },
        { name: "healthcare", displayName: "Healthcare" },
        { name: "finance", displayName: "Finance" },
        { name: "manufacturing", displayName: "Manufacturing" },
        { name: "retail", displayName: "Retail" },
        { name: "other", displayName: "Other" },
      ],
    });
    this.table.enum("industry", "crm_industry");
  }

  /** Add a `crm_industries` lookup table and an FK to it (user-editable industries). */
  tableIndustry() {
    system.db.table("crm_industries", (table) => {
      table.sampleData({
        skipSampleData: true,
      });
      table.string("name", 200).notNull();
    });
    this.table.fk("crm_industries").displayName("Industry");
  }

  /** Add geographic region enum */
  regionEnum() {
    system.enum_({
      name: "crm_region",
      values: [
        { name: "north_america", displayName: "North America" },
        { name: "latam", displayName: "Latin America" },
        { name: "europe", displayName: "Europe" },
        { name: "apac", displayName: "Asia-Pacific" },
        { name: "mena", displayName: "Middle East & Africa" },
      ],
    });
    this.table.enum("region", "crm_region");
  }

  /** Add organization size fields */
  sizeFields() {
    system.enum_({
      name: "crm_org_size",
      values: [
        { name: "smb", displayName: "SMB (1-100)" },
        { name: "mid_market", displayName: "Mid-Market (100-1000)" },
        { name: "enterprise", displayName: "Enterprise (1000+)" },
      ],
    });
    this.table.enum("org_size", "crm_org_size");
    this.table.uint("employee_count");
    this.table.decimal("annual_revenue", { precision: 18, scale: 2 });
  }

  /** Add a multiline `current_state_summary` field. */
  currentStateSummary() {
    this.table.string("current_state_summary", 2000).multiline().displayName(
      "Current State Summary",
    );
  }

  /** Add strategic-sales fields (current state, initiatives, tech stack, budget cycle, decision criteria). */
  strategicFields() {
    this.currentStateSummary();
    this.table.string("strategic_initiatives", 2000).multiline().displayName(
      "Strategic Initiatives",
    );
    this.table.string("tech_stack", 1000).displayName(
      "Existing Tech Footprint",
    );
    this.table.string("budget_cycle", 255).displayName("Budget Cycle");
    this.table.string("decision_criteria", 1000).displayName(
      "Decision Criteria",
    );
  }

  /** Add assigned team member FK */
  assignedTeam() {
    this.table.fk("assigned_to", "sys_users").displayName("Assigned To");
  }

  /** Add partner assignment (FK to crm_partners) */
  assignedPartner() {
    this.table.fk("assigned_partner", "crm_partners").displayName(
      "Assigned Partner",
    );
  }

  /** Add all Yolm CRM account fields at once */
  yolmAccountFields() {
    this.standardStatus();
    this.standardEnumIndustry();
    this.regionEnum();
    this.sizeFields();
    this.strategicFields();
    this.assignedTeam();
    this.assignedPartner();
  }
}

/**
 * Helper passed to the user's `people.define(table, config)` callback.
 * Adds standardized B2B contact fields (persona type, department,
 * relationship strength, engagement score) and a B2C field helper.
 */
export class PeopleConfig {
  constructor(public table: TableBuilder) {}

  /** Add persona type for B2B contacts */
  personaType() {
    system.enum_({
      name: "crm_contact_persona",
      values: [
        {
          name: "decision_maker",
          displayName: "Decision Maker",
          color: "#22C55E",
        },
        { name: "influencer", displayName: "Influencer", color: "#3B82F6" },
        { name: "blocker", displayName: "Blocker", color: "#EF4444" },
        { name: "champion", displayName: "Champion", color: "#8B5CF6" },
        { name: "user", displayName: "User", color: "#6B7280" },
      ],
    });
    this.table.enum("persona", "crm_contact_persona");
  }

  /** Add department field */
  department() {
    system.enum_({
      name: "crm_department",
      values: [
        { name: "executive", displayName: "Executive/C-Suite" },
        { name: "it", displayName: "IT/Technology" },
        { name: "finance", displayName: "Finance" },
        { name: "operations", displayName: "Operations" },
        { name: "sales", displayName: "Sales" },
        { name: "marketing", displayName: "Marketing" },
        { name: "hr", displayName: "Human Resources" },
        { name: "legal", displayName: "Legal" },
        { name: "other", displayName: "Other" },
      ],
    });
    this.table.enum("department", "crm_department");
  }

  /** Add relationship strength score (1-5) */
  relationshipStrength() {
    this.table.smallUint("relationship_strength");
  }

  /** Add engagement score (auto-calculated placeholder) */
  engagementScore() {
    this.table.smallUint("engagement_score");
  }

  /** Add role field (different from job title - their role in buying process) */
  buyingRole() {
    system.enum_({
      name: "crm_buying_role",
      values: [
        { name: "economic_buyer", displayName: "Economic Buyer" },
        { name: "technical_buyer", displayName: "Technical Buyer" },
        { name: "user_buyer", displayName: "User Buyer" },
        { name: "coach", displayName: "Coach" },
      ],
    });
    this.table.enum("buying_role", "crm_buying_role");
  }

  /** Add a `contact_type` enum (prospect/customer/analyst/partner/supplier). */
  contactType() {
    this.table.enum("contact_type", "crm_contact_type");
  }

  /** Add an FK linking the contact to a `crm_partners` record. */
  partnerId() {
    this.table.fk("crm_partners");
  }

  /** Add all Yolm CRM contact fields at once */
  yolmContactFields() {
    this.personaType();
    this.department();
    this.relationshipStrength();
    this.engagementScore();
    this.buyingRole();
    this.contactType();
    this.partnerId();
  }
}

system.enum_({
  name: "crm_contact_type",
  values: [
    { name: "prospect", displayName: "Prospect", color: "#3B82F6" },
    { name: "customer", displayName: "Customer", color: "#22C55E" },
    { name: "analyst", displayName: "Analyst", color: "#8B5CF6" },
    { name: "partner", displayName: "Partner", color: "#F59E0B" },
    { name: "supplier", displayName: "Supplier", color: "#6B7280" },
  ],
});

system.enum_({
  name: "gender_enum",
  values: [
    { name: "male", displayName: "Male" },
    { name: "female", displayName: "Female" },
    { name: "other", displayName: "Other" },
    { name: "prefer_not_to_say", displayName: "Prefer not to say" },
  ],
});

system.enum_({
  name: "contact_preference_enum",
  values: [
    { name: "email", displayName: "Email" },
    { name: "phone", displayName: "Phone" },
    { name: "sms", displayName: "SMS" },
    { name: "mail", displayName: "Mail" },
    { name: "in_person", displayName: "In Person" },
  ],
});
