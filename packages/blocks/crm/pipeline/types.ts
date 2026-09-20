import type { IconName } from "components/material_icon_names";
import type { HelperEnumValue } from "std/system";
import type { Sql } from "std/sql_utils";

export interface PipelineStageFieldConfig {
  name: string;
  type:
    | "string"
    | "text"
    | "number"
    | "decimal"
    | "date"
    | "bool"
    | "enum"
    | "score"
    | "fk";
  enumName?: string;
  enumValues?: HelperEnumValue[];
  scoreRange?: { min: number; max: number };
  required?: boolean;
  displayName?: string;
  description?: string;
}

export interface ExitCriterion {
  name: string;
  displayName?: string;
  /**
   * SQL condition that evaluates to boolean.
   * Has access to `item` record (the pipeline item row).
   * Examples:
   * - `sql\`item.estimated_value is not null\``
   * - `sql\`item.probability_pct >= 50\``
   */
  condition: Sql;
}

export interface PipelineStageAutoTask {
  title: string;
  description?: string;
  dueDaysFromNow?: number;
  priority?: "low" | "medium" | "high";
}

export interface PipelineStageConfig {
  name: string;
  displayName?: string;
  icon?: IconName;
  color?: string;
  fields?: PipelineStageFieldConfig[];
  exitCriteria?: ExitCriterion[];
  exitCriteriaMode?: "all" | "any";
  description?: string;
  autoTasksOnEntry?: PipelineStageAutoTask[];
}

export interface PipelineConfig {
  name: string;
  displayName?: string;
  icon?: IconName;
  description?: string;
  stages: PipelineStageConfig[];
  entityTypes: ("organization" | "person")[];
  enableTasks?: boolean;
  enableActivityLog?: boolean;
  /** Basic deal fields; qualification explicitly adds business-case and competitive fields. */
  opportunityFields?: { qualification?: boolean };
  enablePartnerAttachment?: boolean;
}

export interface CrmPipelineBlockOpts {
  pipelines: PipelineConfig[];
  tablePrefix?: string;
}

export type PipelineActivityType =
  | "item_created"
  | "stage_changed"
  | "field_updated"
  | "task_created"
  | "task_completed"
  | "assigned"
  | "unassigned"
  | "partner_attached"
  | "partner_detached";

export type PipelineEntityType = "organization" | "person";
