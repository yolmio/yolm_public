import { Alert } from "components/alert";
import type { AlertProps } from "components/alert";
import { Button } from "components/button";
import type { ButtonProps } from "components/button";
import { Checkbox } from "components/checkbox";
import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { IconButton } from "components/icon_button";
import type { IconButtonProps } from "components/icon_button";
import { InlineFieldDisplay } from "components/inline_field_display";
import { MaterialIcon } from "components/material_icon";
import { Radio } from "components/radio";
import type { RadioProps } from "components/radio";
import { RadioGroup } from "components/radio_group";
import type { ComponentOpts } from "components/types";
import type { HTMLAttributes } from "std/jsx-dev-runtime";
import {
  CurrentRecordICtxKey,
  CurrentRefetchICtxKey,
  CurrentTableICtxKey,
  type FormGatherICtx,
  FormGatherICtxKey,
  type FormGatherStackFrame,
  type FormGatherStackICtx,
  FormGatherStackICtxKey,
  type FormICtx,
  FormICtxKey,
  type FormStackFrame,
  type FormStackICtx,
  FormStackICtxKey,
  type FormSubmitOptions,
  type FormSubmittingRecord,
  type FormSwitchICtx,
  FormSwitchICtxKey,
} from "./ictx";
import { singularize } from "./inflectors";
import { sql, updateAssignment } from "./sql_utils";
import type { AnyExpr, BooleanExpr, NumericExpr, Sql } from "./sql_utils";
import {
  DomStatements,
  type HelperProcField,
  type IServerBaseStatements,
  type IStatementsBase,
  type StateStatements,
  type UiServerStatements,
} from "./statements";
import type { Style } from "./style_types";
import { system } from "./system";
import type { Field, HelperFieldType, Table } from "./system";
import {
  addCtx,
  type Component,
  Conditional,
  type ContextInstance,
  Each,
  EventHandlers,
  gatherChildrenContextInfo,
  type ICtxKey,
  Match,
  type Node,
  Show,
  Switch,
  useICtx,
  useOptionalICtx,
  usePhase,
  useState,
  useUniqueId,
} from "./ui";
import { dedent } from "./utils";
import type { FieldType } from "./yom";

/**
 * One field tracked inside a {@link FormTable} during the form's gather
 * phase. Holds the field name plus its initial value and (optionally)
 * its database field model.
 */
export interface FormField {
  /** Field name (matches the SQL column). */
  field: string;
  /** Database field model, if the form field is backed by a table column. */
  fieldModel?: Field;
  /** Initial value expression used when the form mounts. */
  initialValue: AnyExpr;
  /** Field is shared across sibling rows (used by `WriteEach`). */
  shared?: boolean;
  /** Optional explicit field type when no `fieldModel` is available. */
  fieldType?: HelperFieldType;
  /** Whether this field is required even without a backing NOT NULL column. */
  required?: boolean;
}

/**
 * Predicate helpers passed to {@link PartialRowValidationOptions.activeWhen}
 * for deciding whether a partially-filled row counts as having user intent.
 * Each method returns a SQL boolean expression over a single field.
 */
export interface PartialRowValidationRow {
  /** True when the field is not null. */
  hasValue(field: string): BooleanExpr;
  /** True when the field is not null and has non-whitespace text. */
  hasText(field: string): BooleanExpr;
  /** True when the field is a true boolean value. */
  isTrue(field: string): BooleanExpr;
  /** True when the field differs from its configured initial value. */
  changedFromInitial(field: string): BooleanExpr;
}

/**
 * Tunes the partial-row validation enabled by {@link PartialRowValidation}.
 * Controls which rows are treated as "active" (user started filling them in)
 * and therefore subject to required-field validation before submit.
 */
export interface PartialRowValidationOptions {
  /** Custom expression for deciding whether a row has user intent. */
  activeWhen?: (row: PartialRowValidationRow) => BooleanExpr;
  /** Explicit required fields for rows that have user intent. */
  required?: string[];
  /** Fields excluded from automatic row-intent and required-field derivation. */
  ignoreFields?: string[];
  /** Error shown on required fields in partial rows. Defaults to `Required`. */
  errorMessage?: Sql | string;
}

/** Enables client-side validation for rows with some, but not all, required input. */
export type PartialRowValidation = boolean | PartialRowValidationOptions;

/**
 * A pseudo-table used to declare form state that doesn't directly map to a
 * database table — e.g. a sub-form whose fields are spread across multiple
 * underlying tables.
 */
export interface IndirectFormTable {
  type: "indirect";
  /** Variable name used to reference the table inside the form. */
  stateName: string;
  /** Source database table whose fields back this indirect form table. */
  table: Table;
  /** Form fields belonging to this indirect table. */
  fields: FormField[];
  /** Related child tables. */
  relations: FormTable[];
}

/** Union of every table shape seen during the form's gather phase. */
export type GatherFormTable = FormTable | IndirectFormTable;

/** Discriminator tags of {@link GatherFormTable}. */
export type GatherFormTableType = GatherFormTable["type"];

interface FormDbTableBase {
  stateName: string;
  table: Table;
  parent?: FormTable;
  relationField?: Field;
  filterOnParentFk: boolean;
  fields: FormField[];
  fkDirection?: "parentToChild" | "childToParent";
  relations: FormTable[];
  dontInitialize?: boolean;
  initializeSource?: Sql;
  initializeValues?: Record<string, AnyExpr>;
  validatePartialRows?: PartialRowValidation;
  optional?: boolean;
  optionalExistsByDefault?: boolean;
  allowInsert?: boolean;
  onInsert?: <T extends IServerBaseStatements>(
    s: T,
    recordId: NumericExpr,
  ) => void;
}

interface FormTableInsert extends FormDbTableBase {
  type: "insert";
  initializeSource?: Sql;
  initializeValues?: Record<string, AnyExpr>;
  insertValues?: Record<string, AnyExpr>;
}

interface FormTableInsertMany extends FormDbTableBase {
  type: "insertMany";
  insertValues?: Record<string, AnyExpr>;
}

interface FormTableUpdate extends FormDbTableBase {
  type: "update";
  where?: BooleanExpr;
  setFields?: Record<string, AnyExpr>;
  filterBeforeSubmit?: BooleanExpr;
}

interface FormTableUpdateMany extends FormDbTableBase {
  type: "updateMany";
  where?: BooleanExpr;
  setFields?: Record<string, AnyExpr>;
  filterBeforeSubmit?: BooleanExpr;
}

interface FormTableMerge extends FormDbTableBase {
  type: "merge";
  where?: BooleanExpr;
  insertValues?: Record<string, AnyExpr>;
  defaultEmptyRecord?: boolean;
  filterEmptyRecords?: boolean;
  filterBeforeSubmit?: BooleanExpr;
}

export type MergeManyDeleteBehavior = "missing" | "initial";

/** Form table that merges (upsert) many rows of `table`. */
export interface FormTableMergeMany extends FormDbTableBase {
  type: "mergeMany";
  where?: BooleanExpr;
  insertValues?: Record<string, AnyExpr>;
  defaultEmptyRecord?: boolean;
  filterEmptyRecords?: boolean;
  filterBeforeSubmit?: BooleanExpr;
  deleteBehavior?: MergeManyDeleteBehavior;
}

/**
 * Form table that lives entirely in UI state (no database row written). Use
 * this for transient sub-forms whose values are read by the surrounding
 * form's submit procedure.
 */
export interface FormTableTemporary {
  type: "temporary";
  /** Variable name used inside the form. */
  stateName: string;
  /** Parent form table (when nested under a relation). */
  parent?: FormTable;
  /** Whether to filter on the parent's foreign key. */
  filterOnParentFk: boolean;
  /** Form fields belonging to the temporary table. */
  fields: FormField[];
  /** Related child tables. */
  relations: FormTable[];
  /** Whether the temporary table is optional. */
  optional?: boolean;
  /** Whether the optional table is mounted by default. */
  optionalExistsByDefault?: boolean;
}

/** Discriminated union of every database-backed form-table variant. */
export type DbBackedTable =
  | FormTableInsert
  | FormTableInsertMany
  | FormTableUpdate
  | FormTableUpdateMany
  | FormTableMerge
  | FormTableMergeMany;

function getOptionalField<T, K extends string>(
  obj: T,
  key: K,
): K extends keyof T ? T[K] : undefined {
  return (obj as any)[key];
}

function isManyTable(
  table: GatherFormTable,
): table is FormTableInsertMany | FormTableUpdateMany | FormTableMergeMany {
  return (
    table.type === "insertMany" ||
    table.type === "updateMany" ||
    table.type === "mergeMany"
  );
}

/** Discriminated union of every form-table variant (db-backed or temporary). */
export type FormTable = DbBackedTable | FormTableTemporary;

class FormGatherContext implements FormGatherICtx, ContextInstance {
  implementICtxs: ICtxKey<any>[] = [FormGatherICtxKey];

  tables: GatherFormTable[] = [];
  defaultFieldComponent?: Component;

  addTable(table: GatherFormTable) {
    this.tables.push(table);
  }

  getTable(name: string) {
    return this.tables.find((table) => table.stateName === name);
  }
}

/**
 * Error reported by the server during {@link FormContext.onSubmitServerError}.
 * `type` is a `sys_error_type` enum value, `message` and `description`
 * are user-facing strings.
 */
export interface FormSubmitError {
  /** Error type (`sys_error_type` enum value as SQL). */
  type: Sql;
  /** User-facing error message. */
  message: Sql;
  /** Longer description for diagnostics. */
  description: Sql;
}

class FormGatherStackCtx implements ContextInstance, FormGatherStackICtx {
  implementICtxs = [FormGatherStackICtxKey];

  constructor(public stack: FormGatherStackFrame[]) {}
}

function extendFormGatherStackCtx(frame: FormGatherStackFrame) {
  addCtx(
    new FormGatherStackCtx([
      ...(useOptionalICtx(FormGatherStackICtxKey)?.stack ?? []),
      frame,
    ]),
  );
}

interface ProcessTableOpts<Table extends DbBackedTable> {
  table: Table;
  parentDbId?: Sql;
  parentUiId?: Sql;
  outputDbIdScalar?: string;
}

const FORM_SUBMITTING_RECORD_TABLE_SCALAR = "write_submitting_record_table";
const FORM_SUBMITTING_RECORD_UI_ID_SCALAR = "write_submitting_record_ui_id";

/**
 * The runtime context for a Form component. Provides access to form-level state and operations.
 *
 * @property submitting - SQL expression (`write_submitting`) that is `true` while the form is being submitted.
 * @property writeError - SQL expression (`write_error`) containing the current error message, or `null` if no error.
 * @property hasAnyError - SQL boolean expression that is `true` when any field validation error or write error exists.
 * @property submit - Triggers form submission: validates all fields, runs the server procedure, and handles errors.
 * @property reset - Resets the form to its initial state by incrementing the reset key.
 * @property stateHash - Returns an SQL expression (MD5 hash) of all current form values, useful for dirty checking.
 */
export class FormContext implements FormICtx, ContextInstance {
  implementICtxs: ICtxKey<any>[] = [FormICtxKey];

  tables: Record<string, FormTable> = {};
  defaultFieldComponent?: Component;

  hasLastSavedStateHash = false;
  resetKey = sql.ref("write_reset_key");
  keepHistory = false;
  historyThrottleTime = 3_000;

  beforeSubmitClient?: (s: DomStatements, ctx: FormContext) => unknown;
  private readonly authorizationHooks: Array<
    (s: UiServerStatements) => unknown
  > = [];
  registerAuthorization = (hook: (s: UiServerStatements) => unknown) => {
    this.authorizationHooks.push(hook);
  };
  private readonly beforeValidationClientHooks: Array<
    (s: DomStatements) => unknown
  > = [];
  registerBeforeValidationClient = (hook: (s: DomStatements) => unknown) => {
    this.beforeValidationClientHooks.push(hook);
  };
  beforeTransactionStart?: (
    s: UiServerStatements,
    ctx: FormContext,
  ) => unknown;
  afterTransactionStart?: (s: UiServerStatements, ctx: FormContext) => unknown;
  beforeTransactionCommit?: (
    s: UiServerStatements,
    ctx: FormContext,
  ) => unknown;
  afterTransactionCommit?: (
    s: UiServerStatements,
    ctx: FormContext,
  ) => unknown;
  afterSubmitClientSuccess?: (s: DomStatements, ctx: FormContext) => unknown;
  onSubmitError?: (s: DomStatements, ctx: FormContext) => unknown;
  onSubmitServerError?: (
    s: UiServerStatements,
    ctx: FormContext,
    err: FormSubmitError,
  ) => unknown;
  refetchOnSuccess = true;

  submitting = sql.ref("write_submitting");
  submittingRecordTable = sql.ref(FORM_SUBMITTING_RECORD_TABLE_SCALAR);
  submittingRecordUiId = sql.ref(FORM_SUBMITTING_RECORD_UI_ID_SCALAR);
  setSubmitting = <T extends IStatementsBase>(s: T, waiting: BooleanExpr) => {
    return s.setScalar("write_submitting", waiting);
  };
  submittingRecord = (table: string, recordUiId: NumericExpr) =>
    sql.and(
      this.submitting,
      sql`${this.submittingRecordTable} = ${sql.lit(table)}`,
      sql`${this.submittingRecordUiId} = ${recordUiId}`,
    );

  setSubmittingRecord = <T extends IStatementsBase>(
    s: T,
    record?: FormSubmittingRecord,
  ) => {
    s.setScalar(
      FORM_SUBMITTING_RECORD_TABLE_SCALAR,
      record ? sql.lit(record.table) : sql`null::string`,
    );
    s.setScalar(
      FORM_SUBMITTING_RECORD_UI_ID_SCALAR,
      record?.recordUiId ?? sql`null::bigint`,
    );
  };

  clearSubmittingRecord = <T extends IStatementsBase>(s: T) => {
    this.setSubmittingRecord(s);
  };

  writeError = sql.ref("write_error");
  setWriteError = <T extends IStatementsBase>(s: T, error: Sql) => {
    return s.setScalar("write_error", error);
  };
  hasWriteError = sql`${this.writeError} is not null`;

  reset = <T extends IStatementsBase>(s: T) => {
    s.increment(this.resetKey);
  };

  submit = (s: DomStatements, opts?: FormSubmitOptions) => {
    s.returnIf(this.submitting);
    this.resetErrorState(s);
    for (const hook of this.beforeValidationClientHooks) {
      hook(s);
    }
    this.setTouchedAll(s);
    this.validateFields(s);
    this.validatePartialRows(s);
    this.beforeSubmitClient?.(s, this);
    s.if(this.hasAnyError, (s) => {
      this.debugTables(s);
      this.onSubmitError?.(s, this);
      s.return();
    });
    this.setSubmitting(s, sql.true);
    this.setSubmittingRecord(s, opts?.submittingRecord);
    s.commitUiTreeChanges();
    const serverBody = (s: UiServerStatements) => {
      this.beforeTransactionStart?.(s, this);
      s.returnIf(this.hasAnyError);
      s.startTransaction();
      for (const authorize of this.authorizationHooks) authorize(s);
      this.afterTransactionStart?.(s, this);
      for (const table of Object.values(this.tables)) {
        if (table.type === "temporary" || table.parent) {
          continue;
        }
        this.processTable(s, {
          table: table as DbBackedTable,
        });
      }
      this.beforeTransactionCommit?.(s, this);
      opts?.beforeTransactionCommit?.(s);
      s.commitTransaction();
      this.afterTransactionCommit?.(s, this);
      if (this.refetchOnSuccess) {
        s.refetch();
      }
    };
    s.tryServer({
      body: this.onSubmitServerError
        ? (s) => {
          s.try({
            body: serverBody,
            errorName: "submit_err",
            catch: (s) => {
              s.rollbackIfInTransaction();
              s.try({
                errorName: "submit_error_hook_err",
                body: (s) => {
                  this.onSubmitServerError!(s, this, {
                    type: sql`submit_err.type`,
                    message: sql`submit_err.message`,
                    description: sql`submit_err.description`,
                  });
                },
                catch: (s) => {
                  s.logError(
                    sql.concat(
                      "onSubmitServerError hook failed while handling form submit error. Original error: ",
                      sql`coalesce(submit_err.message, '')`,
                      ". Hook error: ",
                      sql`coalesce(submit_error_hook_err.message, '')`,
                    ),
                    sql.lit`onSubmitServerError`,
                  );
                },
              });
              s.unless(
                this.hasAnyError,
                (s) =>
                  s.throwError(
                    sql`coalesce(submit_err.message, 'Failed to submit form')`,
                    sql`submit_err.description`,
                  ),
              );
            },
          });
        }
        : serverBody,
      errorName: "err",
      catch: (s) => {
        s.debugExpr(sql.lit`Error in form submission`);
        s.debugExpr(sql`err.type`);
        s.debugExpr(sql`err.message`);
        s.debugExpr(sql`err.description`);
        this.setWriteError(
          s,
          sql`case
            when err.type = 'service_proc_error' then 'Failed to connect to server, please try again'
            else coalesce(err.message, 'Failed to submit form')
          end`,
        );
      },
      finally: (s) => {
        this.setSubmitting(s, sql.false);
        this.clearSubmittingRecord(s);
      },
    });
    s.conditional({
      condition: this.hasAnyError,
      then: (s) => {
        this.onSubmitError?.(s, this);
      },
      else: (s) => {
        this.debugTables(s);
        this.afterSubmitClientSuccess?.(s, this);
        if (this.hasLastSavedStateHash) {
          s.setScalar("last_saved_state_hash", this.stateHash());
        }
      },
    });
  };

  /**
   * Returns a SQL expression that serializes all form table field values into
   * a human-readable text blob. Intended for server-side error logging so the
   * raw input values that caused a submission failure are captured.
   */
  formDataDump(): Sql {
    const parts: string[] = [];
    function addTable(table: FormTable) {
      if (table.type === "temporary") return;
      const isMany = table.type === "insertMany" ||
        table.type === "updateMany" ||
        table.type === "mergeMany";
      const fieldParts: string[] = [];
      for (const field of table.fields) {
        const ref = field.shared
          ? `ui.${table.stateName}_shared_fields.${field.field}`
          : isMany
          ? field.field
          : `ui.${table.stateName}.${field.field}`;
        fieldParts.push(
          `'${field.field}=',coalesce(${ref}::string,'NULL')`,
        );
      }
      if (fieldParts.length === 0) return;
      const rowConcat = fieldParts.join(",'|',");
      if (isMany) {
        parts.push(
          `coalesce((select string_agg(concat('${table.stateName}: ',${rowConcat}),chr(10)) from ui.${table.stateName}),'')`,
        );
      } else {
        parts.push(
          `concat('${table.stateName}: ',${rowConcat})`,
        );
      }
      for (const relation of table.relations) {
        addTable(relation);
      }
    }
    for (const table of Object.values(this.tables)) {
      if (table.parent) continue;
      addTable(table);
    }
    if (parts.length === 0) return sql.lit``;
    return sql(parts.join(" || chr(10) || "));
  }

  debugTables = <T extends IStatementsBase>(s: T) => {
    function debugTable(table: FormTable) {
      s.debugQuery(sql`select * from ${sql.ref(table.stateName)}`);
      for (const relation of table.relations) {
        debugTable(relation);
      }
    }
    for (const table of Object.values(this.tables)) {
      debugTable(table);
    }
  };

  resetErrorState = <T extends IStatementsBase>(s: T) => {
    this.setWriteError(s, sql.null);
    for (const table of Object.values(this.tables)) {
      for (const field of table.fields) {
        const tableIdent = field.shared
          ? sql.ref(`ui.${table.stateName}_shared_fields`)
          : sql.ref(`ui.${table.stateName}`);
        s.modify(
          sql`update ${tableIdent} set ${
            sql.ref(
              `${field.field}_write_error`,
            )
          } = null`,
        );
      }
    }
  };

  setTouchedAll = <T extends IStatementsBase>(s: T) => {
    for (const table of Object.values(this.tables)) {
      for (const field of table.fields) {
        const tableIdent = field.shared
          ? sql.ref(`ui.${table.stateName}_shared_fields`)
          : sql.ref(`ui.${table.stateName}`);
        s.modify(
          sql`update ${tableIdent} set ${
            sql.ref(
              `${field.field}_write_touched`,
            )
          } = true`,
        );
      }
    }
  };

  setTouchedNone = <T extends IStatementsBase>(s: T) => {
    for (const table of Object.values(this.tables)) {
      for (const field of table.fields) {
        const tableIdent = field.shared
          ? sql.ref(`ui.${table.stateName}_shared_fields`)
          : sql.ref(`ui.${table.stateName}`);
        s.modify(
          sql`update ${tableIdent} set ${
            sql.ref(
              `${field.field}_write_touched`,
            )
          } = false`,
        );
      }
    }
  };

  private validateFields(s: DomStatements) {
    for (const table of Object.values(this.tables)) {
      if (table.type === "temporary") {
        this.validateTemporaryTableFields(s, table);
        continue;
      }
      if (table.fields.some((field) => field.shared)) {
        this.validateTableFields(
          s,
          table as DbBackedTable,
          `ui.${table.stateName}_shared_fields`,
          true,
        );
      }
      if (isManyTable(table) || getOptionalField(table, "filterBeforeSubmit")) {
        const recordName = `${table.stateName}_for_record`;
        s.forEachTableWithOpts({
          table: `ui.${table.stateName}`,
          where: getOptionalField(table, "filterBeforeSubmit"),
          cursorName: recordName,
          body: (s) => {
            this.validateTableFields(s, table as DbBackedTable, recordName);
          },
        });
      } else {
        const recordName = `ui.${table.stateName}`;
        this.validateTableFields(s, table as DbBackedTable, recordName);
      }
    }
  }

  private validateTemporaryTableFields(
    s: DomStatements,
    table: FormTableTemporary,
  ) {
    const recordName = `ui.${table.stateName}`;
    const recordIdent = sql.ref(recordName);
    for (const field of table.fields) {
      if (!field.required) {
        continue;
      }
      const fieldIdent = sql.ref(field.field);
      const fieldErrorIdent = sql.ref(`${field.field}_write_error`);
      s.modify(sql`
        update ${recordIdent}
        set ${fieldErrorIdent} = 'Required'
        where ${fieldErrorIdent} is null
          and (
            ${fieldIdent} is null
            or trim(cast(${fieldIdent} as string)) = ''
          )
      `);
    }
  }

  private validateTableFields(
    s: DomStatements,
    table: DbBackedTable,
    recordName: string,
    shared = false,
  ) {
    for (const field of table.fields) {
      if (shared !== Boolean(field.shared)) {
        continue;
      }
      const fieldModel = table.table.fields[field.field];
      if (!fieldModel) {
        throw new Error(
          `Field ${field.field} not found in table ${table.table.name}`,
        );
      }
      const recordIdent = sql.ref(recordName);
      const fieldIdent = sql.ref(field.field);
      const fieldErrorIdent = sql.ref(`${field.field}_write_error`);
      const fieldTouchedIdent = sql.ref(`${field.field}_write_touched`);
      const fieldHelper: FormFieldHelper = {
        value: sql`${recordIdent}.${fieldIdent}`,
        error: sql`${recordIdent}.${fieldErrorIdent}`,
        setError: (s, error: Sql) =>
          s.modify(
            sql`update ${recordIdent} set ${fieldErrorIdent} = ${error}`,
          ),
        setValue: (s, value: AnyExpr) =>
          s.modify(sql`update ${recordIdent} set ${fieldIdent} = ${value}`),
        setTouched: (s, touched: BooleanExpr) =>
          s.modify(
            sql`update ${recordIdent} set ${fieldTouchedIdent} = ${touched}`,
          ),
        hasError: sql`${recordIdent}.${fieldErrorIdent} is not null`,
        touched: sql`${recordIdent}.${fieldTouchedIdent}`,
      };
      defaultValidate(fieldModel, fieldHelper, s);
    }
  }

  private validatePartialRows(s: DomStatements) {
    const validateTable = (table: FormTable) => {
      if (table.type !== "temporary" && table.validatePartialRows) {
        this.validateTablePartialRows(s, table);
      }
      for (const relation of table.relations) {
        validateTable(relation);
      }
    };
    for (const table of Object.values(this.tables)) {
      validateTable(table);
    }
  }

  private validateTablePartialRows(s: DomStatements, table: DbBackedTable) {
    const options = normalizePartialRowValidation(table.validatePartialRows);
    if (!options) {
      return;
    }
    validatePartialRowOptionFields(table, options);
    const recordName = `${table.stateName}_partial_row_record`;
    const activeRow = partialRowActiveExpr(table, recordName, options);
    const tableIdent = sql.ref(`ui.${table.stateName}`);
    const recordIdent = sql.ref(recordName);
    s.modify(sql`
      delete from ${tableIdent} as ${recordIdent}
      where ${sql.not(activeRow)}
    `);
    const assignments = partialRowErrorAssignments(table, recordName, options);
    if (assignments.length === 0) {
      return;
    }
    s.modify(sql`
      update ${tableIdent} as ${recordIdent}
      set ${assignments}
    `);
  }

  get hasAnyError(): BooleanExpr {
    let hasError: BooleanExpr = sql.false;
    for (const table of Object.values(this.tables)) {
      hasError = sql.or(hasError, this.tableHasError(table));
    }
    return sql.or(hasError, this.hasWriteError);
  }

  private tableHasError(table: FormTable): BooleanExpr {
    let hasError: BooleanExpr = sql.false;
    let hasNonSharedFields = false;
    for (const field of table.fields) {
      if (!field.shared) {
        hasNonSharedFields = true;
        continue;
      }
      hasError = sql.or(
        hasError,
        sql`${
          sql.ref(
            `ui.${table.stateName}_shared_fields.${field.field}_write_error`,
          )
        } is not null`,
      );
    }
    if (hasNonSharedFields) {
      if (isManyTable(table) || getOptionalField(table, "filterBeforeSubmit")) {
        const recordName = `${table.stateName}_record`;
        hasError = sql`exists (select 1 from ui.${
          sql.ref(table.stateName)
        } as ${sql.ref(recordName)} where (${
          this.fieldsHaveError(
            table,
            recordName,
          )
        }) or write_record_error is not null)`;
      } else {
        const recordName = `ui.${table.stateName}`;
        hasError = this.fieldsHaveError(table, recordName);
      }
      for (const relation of table.relations) {
        hasError = sql.or(hasError, this.tableHasError(relation));
      }
    }
    return hasError;
  }

  private fieldsHaveError(table: FormTable, recordName: string): BooleanExpr {
    return sql.or(
      ...table.fields
        .filter((field) => !field.shared)
        .map(
          (field) =>
            sql`${sql.ref(recordName)}.${
              sql.ref(`${field.field}_write_error`)
            } is not null`,
        ),
    );
  }

  private processTable(
    s: UiServerStatements,
    opts: ProcessTableOpts<DbBackedTable>,
  ) {
    s.pushSource(
      `Write process table ${opts.table.table.name} for ${opts.table.type}`,
    );
    switch (opts.table.type) {
      case "insert":
      case "insertMany":
        this.handleInsert(
          s,
          opts as ProcessTableOpts<FormTableInsert | FormTableInsertMany>,
        );
        break;
      case "update":
      case "updateMany":
        this.handleUpdate(s, opts);
        break;
      case "merge":
      case "mergeMany":
        this.handleMerge(s, opts as ProcessTableOpts<FormTableMerge>);
        break;
    }
    s.popSource();
  }

  private handleInsert(
    s: UiServerStatements,
    opts: ProcessTableOpts<FormTableInsert | FormTableInsertMany>,
  ) {
    if (opts.table.filterOnParentFk) {
      const recordName = `${opts.table.stateName}_for_record`;

      s.forEachQuery(
        sql`select * from ui.${
          sql.ref(opts.table.stateName)
        } where parent_write_ui_id = ${opts.parentUiId!}`,
        recordName,
        (s) => {
          this.insertRecord(s, opts, recordName);
        },
      );
      return;
    }
    if (isManyTable(opts.table)) {
      const recordName = `${opts.table.stateName}_for_record`;
      s.forEachTable(`ui.${opts.table.stateName}`, recordName, (s) => {
        this.insertRecord(s, opts, recordName);
      });
    } else {
      this.insertRecord(s, opts, `ui.${opts.table.stateName}`);
    }
  }

  private insertRecord(
    s: UiServerStatements,
    opts: ProcessTableOpts<DbBackedTable>,
    recordName: string,
  ) {
    const insertFields: string[] = [];
    const insertValues: AnyExpr[] = [];
    for (const field of opts.table.fields) {
      insertFields.push(field.field);
      const fieldModel = opts.table.table.fields[field.field];
      const recordIdent = field.shared
        ? sql.ref(`ui.${opts.table.stateName}_shared_fields`)
        : sql.ref(recordName);
      insertValues.push(
        getDbValueFromFormValue(
          fieldModel,
          sql`${recordIdent}.${sql.ref(field.field)}`,
        ),
      );
    }
    if ("insertValues" in opts.table && opts.table.insertValues) {
      for (const [key, value] of Object.entries(opts.table.insertValues)) {
        insertFields.push(key);
        insertValues.push(value);
      }
    }
    if (
      opts.table.parent &&
      opts.table.relationField &&
      opts.table.fkDirection === "childToParent"
    ) {
      insertFields.push(opts.table.relationField.name);
      insertValues.push(opts.parentDbId!);
    }
    for (const relation of opts.table.relations) {
      if (
        "fkDirection" in relation &&
        relation.fkDirection === "childToParent"
      ) {
        continue;
      }
      if (
        "fkDirection" in relation &&
        relation.fkDirection === "parentToChild" &&
        (relation as DbBackedTable).allowInsert === false
      ) {
        continue;
      }
      const scalarName =
        `relation_${opts.table.stateName}_${relation.stateName}_db_id`;
      s.defScalar(scalarName, {
        type: "BigUint",
      });
      this.processTable(s, {
        table: relation as DbBackedTable,
        parentDbId: opts.parentDbId,
        parentUiId: opts.parentUiId,
        outputDbIdScalar: scalarName,
      });
      insertFields.push((relation as DbBackedTable).relationField!.name);
      insertValues.push(sql.ref(scalarName));
    }
    const doInsert = (s: UiServerStatements) => {
      s.modify(
        sql.insertValues(
          opts.table.table.identWithDb,
          insertFields,
          insertValues,
        ),
      );
      opts.table.onInsert?.(
        s,
        sql`last_record_id(${opts.table.table.identWithDb})`,
      );
      if (opts.outputDbIdScalar) {
        s.setScalar(
          opts.outputDbIdScalar,
          sql`last_record_id(${opts.table.table.identWithDb})`,
        );
      }
      if (opts.table.relations.length > 0) {
        s.defScalar(`inserted_${opts.table.stateName}_db_id`, {
          expr: sql`last_record_id(${opts.table.table.identWithDb})`,
          allowNoRead: true,
        });
        s.defScalar(`inserted_${opts.table.stateName}_ui_id`, {
          expr: sql`${sql.ref(recordName)}.write_ui_id`,
          allowNoRead: true,
        });
        for (const relation of opts.table.relations) {
          if (relation.type === "temporary") {
            continue;
          }
          if (
            "fkDirection" in relation &&
            relation.fkDirection === "parentToChild"
          ) {
            continue;
          }
          this.processTable(s, {
            table: relation as DbBackedTable,
            parentDbId: sql.ref(`inserted_${opts.table.stateName}_db_id`),
            parentUiId: sql.ref(`inserted_${opts.table.stateName}_ui_id`),
          });
        }
      }
    };
    if (opts.table.optional) {
      s.if(sql`${sql.ref(recordName)}.write_relation_exists`, (s) => {
        doInsert(s);
      });
    } else {
      doInsert(s);
    }
  }

  private handleUpdate(
    s: UiServerStatements,
    opts: ProcessTableOpts<DbBackedTable>,
  ) {
    if (opts.table.filterOnParentFk) {
      const recordName = `${opts.table.stateName}_record`;
      s.forEachQuery(
        sql`select * from ui.${
          sql.ref(opts.table.stateName)
        } where parent_write_ui_id = ${opts.parentUiId!}`,
        recordName,
        (s) => {
          this.updateRecord(s, opts, recordName);
        },
      );
      return;
    }
    if (isManyTable(opts.table)) {
      const recordName = `${opts.table.stateName}_record`;
      s.forEachTableWithOpts({
        table: `ui.${opts.table.stateName}`,
        where: getOptionalField(opts.table, "filterBeforeSubmit"),
        cursorName: recordName,
        body: (s) => {
          this.updateRecord(s, opts, recordName);
        },
      });
    } else {
      const recordName = `ui.${opts.table.stateName}`;
      this.updateRecord(s, opts, recordName);
    }
  }

  private updateRecord(
    s: UiServerStatements,
    opts: ProcessTableOpts<DbBackedTable>,
    recordName: string,
  ) {
    const updateAssignments = opts.table.fields.map((field) => {
      const fieldModel = opts.table.table.fields[field.field];
      return updateAssignment(
        fieldModel.ident,
        getDbValueFromFormValue(
          fieldModel,
          sql`${sql.ref(recordName)}.${sql.ref(field.field)}`,
        ),
      );
    });
    if ("setFields" in opts.table && opts.table.setFields) {
      for (const [key, value] of Object.entries(opts.table.setFields)) {
        updateAssignments.push(updateAssignment(sql.ref(key), value));
      }
    }
    for (const relation of opts.table.relations) {
      if (
        "fkDirection" in relation &&
        relation.fkDirection === "childToParent"
      ) {
        continue;
      }
      const isParentToChildRelation = "fkDirection" in relation &&
        relation.fkDirection === "parentToChild";
      const relationCanInsert = (relation as DbBackedTable).allowInsert ??
        true;
      const scalarName = isParentToChildRelation
        ? undefined
        : `relation_${opts.table.stateName}_${relation.stateName}_db_id`;
      if (scalarName) {
        s.defScalar(scalarName, {
          type: "BigUint",
        });
      }
      this.processTable(s, {
        table: relation as DbBackedTable,
        parentDbId: sql`${sql.ref(recordName)}.write_db_id`,
        parentUiId: sql`${sql.ref(recordName)}.write_ui_id`,
        outputDbIdScalar: scalarName,
      });
      const relationValue = isParentToChildRelation
        ? relation.optional
          ? sql`case when ui.${
            sql.ref(relation.stateName)
          }.write_relation_exists then coalesce((select ${
            (relation as DbBackedTable).relationField!.ident
          } from ${opts.table.table.identWithDb} where ${opts.table.table.primaryKeyIdent} = ${sql`${
            sql.ref(recordName)
          }.write_db_id`}), ui.${
            sql.ref(relation.stateName)
          }.write_db_id) else null end`
          : sql`coalesce((select ${
            (relation as DbBackedTable).relationField!.ident
          } from ${opts.table.table.identWithDb} where ${opts.table.table.primaryKeyIdent} = ${sql`${
            sql.ref(recordName)
          }.write_db_id`}), ui.${sql.ref(relation.stateName)}.write_db_id)`
        : sql.ref(scalarName!);
      if (!isParentToChildRelation || relationCanInsert) {
        updateAssignments.push(
          updateAssignment(
            (relation as DbBackedTable).relationField!.ident,
            relationValue,
          ),
        );
      }
    }
    if (opts.outputDbIdScalar) {
      s.setScalar(
        opts.outputDbIdScalar,
        sql`${sql.ref(recordName)}.write_db_id`,
      );
    }
    if (updateAssignments.length !== 0) {
      const idField = opts.table.table.primaryKeyIdent;
      s.modify(
        sql`update ${opts.table.table.identWithDb} set ${updateAssignments} where ${
          sql.ref(
            idField,
          )
        } = ${sql`${sql.ref(recordName)}.write_db_id`}`,
      );
    }
    if (opts.table.relations.length > 0) {
      s.defScalar(`updated_${opts.table.stateName}_db_id`, {
        expr: sql`${sql.ref(recordName)}.write_db_id`,
        allowNoRead: true,
      });
      s.defScalar(`updated_${opts.table.stateName}_ui_id`, {
        expr: sql`${sql.ref(recordName)}.write_ui_id`,
        allowNoRead: true,
      });
      for (const relation of opts.table.relations) {
        if (relation.type === "temporary") {
          continue;
        }
        if (
          "fkDirection" in relation &&
          relation.fkDirection === "parentToChild"
        ) {
          continue;
        }
        this.processTable(s, {
          table: relation as DbBackedTable,
          parentDbId: sql.ref(`updated_${opts.table.stateName}_db_id`),
          parentUiId: sql.ref(`updated_${opts.table.stateName}_ui_id`),
        });
      }
    }
  }

  private handleMerge(
    s: UiServerStatements,
    opts: ProcessTableOpts<FormTableMerge | FormTableMergeMany>,
  ) {
    const { table, parentDbId, parentUiId } = opts;
    let whereClause: BooleanExpr = table.where ?? sql.true;
    if (
      table.parent &&
      table.relationField &&
      table.fkDirection === "childToParent"
    ) {
      whereClause = sql.and(
        whereClause,
        sql`${table.relationField.ident} = ${parentDbId!}`,
      );
    }
    if (table.fkDirection === "parentToChild") {
      const tableModel = (table as DbBackedTable).table;
      const parentTableModel = (table.parent as DbBackedTable).table;
      whereClause = sql.and(
        whereClause,
        sql`${tableModel!.primaryKeyIdent} = (select ${
          table.relationField!.ident
        } from ${parentTableModel!.identWithDb} where ${
          parentTableModel!.primaryKeyIdent
        } = ${parentDbId!})`,
      );
    }
    if (
      (isManyTable(table) || parentDbId) &&
      table.fkDirection !== "parentToChild"
    ) {
      const recordName = `${table.stateName}_record`;
      s.defTable(`${table.stateName}_to_keep`, {
        fields: [{ name: "id", type: "BigUint" }],
      });
      const toKeepIdent = sql.ref(`${table.stateName}_to_keep`);
      const mergeRecordId = `${table.stateName}_merge_record_id`;
      const mergeRecordIdRef = sql.ref(mergeRecordId);
      // Clear the to_keep table in case this runs inside a parent loop
      // where tableDef doesn't reset the table on subsequent iterations
      s.modify(sql`delete from ${toKeepIdent}`);
      const mergeBody = (s: UiServerStatements) => {
        s.defScalar(
          mergeRecordId,
          sql`${sql.ref(recordName)}.write_db_id`,
        );
        s.conditional({
          condition: sql`${mergeRecordIdRef} is null`,
          then: (s) => {
            if (table.allowInsert === false) {
              s.throwError(
                sql.lit`Cannot create a related record from this form`,
                sql
                  .lit`This relation is configured to link existing records only.`,
              );
            } else {
              this.insertRecord(s, opts, recordName);
              s.modify(
                sql`insert into ${toKeepIdent} (id) values (last_record_id(${table.table.identWithDb}))`,
              );
              s.modify(
                sql`update ui.${
                  sql.ref(table.stateName)
                } set write_db_id = last_record_id(${table.table.identWithDb}) where write_ui_id = ${
                  sql.ref(recordName)
                }.write_ui_id`,
              );
            }
          },
          else: (s) => {
            this.updateRecord(s, opts, recordName);
            s.modify(
              sql`insert into ${toKeepIdent} (id) values (${mergeRecordIdRef})`,
            );
          },
        });
      };
      if (table.filterOnParentFk) {
        // Use forEachQuery so the parent FK filter is evaluated fresh each
        // time this runs inside a parent forEach, avoiding the stale-WHERE
        // issue that forEachTableWithOpts has with scalar references.
        s.forEachQuery(
          sql`select * from ui.${
            sql.ref(table.stateName)
          } where parent_write_ui_id = ${parentUiId!}${
            table.filterBeforeSubmit
              ? sql` and ${table.filterBeforeSubmit}`
              : sql``
          }`,
          recordName,
          mergeBody,
        );
      } else {
        s.forEachTableWithOpts({
          table: `ui.${table.stateName}`,
          where: table.filterBeforeSubmit,
          cursorName: recordName,
          body: mergeBody,
        });
      }
      if (table.allowInsert !== false) {
        if (hasInitialDbIdsTable(table)) {
          s.modify(
            sql`delete from ${table.table.identWithDb} where ${whereClause} and ${table.table.primaryKeyIdent} in (select id from ui.${
              sql.ref(initialDbIdsTableName(table))
            }) and ${table.table.primaryKeyIdent} not in (select id from ${toKeepIdent})`,
          );
        } else {
          s.modify(
            sql`delete from ${table.table.identWithDb} where ${whereClause} and id not in (select id from ${toKeepIdent})`,
          );
        }
      }
    } else {
      const recordName = `ui.${table.stateName}`;
      const recordId = table.fkDirection === "parentToChild"
        ? sql`(select ${table.relationField!.ident} from ${
          (table.parent as DbBackedTable).table.identWithDb
        } where ${
          (table.parent as DbBackedTable).table.primaryKeyIdent
        } = ${parentDbId!})`
        : sql`${sql.ref(recordName)}.write_db_id`;
      const syncParentToChildRecordId = (s: UiServerStatements) => {
        if (table.fkDirection === "parentToChild") {
          s.modify(
            sql`update ${sql.ref(recordName)} set write_db_id = ${recordId}`,
          );
        }
      };
      const throwInsertDisabled = (s: UiServerStatements) => {
        s.throwError(
          sql.lit`Cannot create a related record from this form`,
          sql.lit`This relation is configured to link existing records only.`,
        );
      };
      if (table.filterBeforeSubmit) {
        s.conditional({
          condition: sql`exists (select 1 from ui.${
            sql.ref(table.stateName)
          } where ${table.filterBeforeSubmit})`,
          then: (s) => {
            s.conditional({
              condition: sql`${recordId} is null`,
              then: (s) => {
                if (table.allowInsert === false) {
                  throwInsertDisabled(s);
                } else {
                  this.insertRecord(s, opts, recordName);
                  s.modify(
                    sql`update ${
                      sql.ref(recordName)
                    } set write_db_id = last_record_id(${table.table.identWithDb})`,
                  );
                }
              },
              else: (s) => {
                syncParentToChildRecordId(s);
                this.updateRecord(s, opts, recordName);
              },
            });
          },
          else: (s) => {
            if (table.allowInsert !== false) {
              s.modify(
                sql`delete from ${table.table.identWithDb} where ${whereClause}`,
              );
            }
          },
        });
      } else if (table.optional) {
        s.conditional({
          condition: sql`${sql.ref(recordName)}.write_relation_exists`,
          then: (s) => {
            s.conditional({
              condition: sql`${recordId} is null`,
              then: (s) => {
                if (table.allowInsert === false) {
                  throwInsertDisabled(s);
                } else {
                  this.insertRecord(s, opts, recordName);
                  s.modify(
                    sql`update ${
                      sql.ref(recordName)
                    } set write_db_id = last_record_id(${table.table.identWithDb})`,
                  );
                }
              },
              else: (s) => {
                syncParentToChildRecordId(s);
                this.updateRecord(s, opts, recordName);
              },
            });
          },
          else: (s) => {
            if (table.allowInsert !== false) {
              s.modify(
                sql`delete from ${table.table.identWithDb} where ${table.table.primaryKeyIdent} = ${recordId}`,
              );
            }
          },
        });
      } else {
        s.conditional({
          condition: sql`${recordId} is null`,
          then: (s) => {
            if (table.allowInsert === false) {
              throwInsertDisabled(s);
            } else {
              this.insertRecord(s, opts, recordName);
              s.modify(
                sql`update ${
                  sql.ref(recordName)
                } set write_db_id = last_record_id(${table.table.identWithDb})`,
              );
            }
          },
          else: (s) => {
            syncParentToChildRecordId(s);
            this.updateRecord(s, opts, recordName);
          },
        });
      }
    }
  }

  /**
       Returns an md5 hash of the state without errors or touched fields.

       Use this to detect if the state has changed.
       */
  stateHash() {
    const exprs: AnyExpr[] = [];
    function addTable(table: FormTable) {
      exprs.push(sql.lit`/`);
      if (isManyTable(table)) {
        let sharedFields = "";
        let fields = "";
        for (const field of table.fields) {
          if (field.shared) {
            if (sharedFields) {
              sharedFields += ",'-',";
            }
            sharedFields +=
              `coalesce(${table.stateName}_shared_fields.${field.field}::string, '')`;
            continue;
          }
          if (fields) {
            fields += ",'-',";
          }
          fields += `coalesce(${field.field}::string, '')`;
        }
        if (sharedFields) {
          exprs.push(sql`concat(${sql(sharedFields)})`);
        }
        if (fields) {
          exprs.push(
            sql`(coalesce((select string_agg(concat(${
              sql(fields)
            }), ',' order by write_ui_id) from ${
              sql.ref(table.stateName)
            }), ''))`,
          );
        }
      } else {
        let fields = "";
        for (const field of table.fields) {
          if (fields) {
            fields += ",'-',";
          }
          fields += `coalesce(${table.stateName}.${field.field}::string, '')`;
        }
        if (fields) {
          exprs.push(sql(fields));
        }
      }
      for (const relation of table.relations) {
        addTable(relation);
      }
    }
    for (const table of Object.values(this.tables)) {
      addTable(table);
    }
    const concatExprs = exprs.map((ex) => sql.exprToString(ex)).join(",");
    return sql`crypto.md5(concat(${sql(concatExprs)}))`;
  }

  #findTableShallow(table: FormTable, name: string): FormTable | undefined {
    if (
      table.stateName === name ||
      ("table" in table && table.table?.name === name)
    ) {
      return table;
    }
    for (const relation of table.relations) {
      const found = this.#findTableShallow(relation, name);
      if (found) {
        return found;
      }
    }
  }

  #findTable(name: string): FormTable | undefined {
    const table = this.tables[name];
    if (table) {
      return table;
    }
    for (const table of Object.values(this.tables)) {
      const found = this.#findTableShallow(table, name);
      if (found) {
        return found;
      }
    }
  }

  table(name: string): TableHelper {
    const table = this.#findTable(name);
    if (!table) {
      throw new Error(`Table ${name} not found`);
    }
    return new TableHelper(this.keepHistory, this.historyThrottleTime, table);
  }

  record(name: string): RecordHelper {
    const table = this.#findTable(name);
    if (!table) {
      throw new Error(`Table ${name} not found`);
    }
    if (isManyTable(table)) {
      throw new Error(`Cannot get record helper for many table ${name}`);
    }
    return new RecordHelper(this.keepHistory, this.historyThrottleTime, table);
  }

  get historyIndex() {
    if (!this.keepHistory) {
      throw new Error("History is not enabled");
    }
    return sql`write_current_history_index`;
  }

  get canRedo() {
    if (!this.keepHistory) {
      throw new Error("History is not enabled");
    }
    return sql`undo_from_history_index is not null`;
  }

  get canUndo() {
    if (!this.keepHistory) {
      throw new Error("History is not enabled");
    }
    return sql`write_can_undo`;
  }

  undo<T extends IStatementsBase>(s: T) {
    if (!this.keepHistory) {
      throw new Error("History is not enabled");
    }
    s.if(sql`undo_from_history_index is null`, (s) => {
      s.setScalar("undo_from_history_index", sql`write_current_history_index`);
    });
    s.increment("write_current_history_index", -1);
    s.if(sql`write_current_history_index = 0`, (s) => {
      s.setScalar("write_can_undo", false);
    });
    for (const table of Object.values(this.tables)) {
      applyHistory(s, sql`write_current_history_index`, table);
    }
  }

  redo<T extends IStatementsBase>(s: T) {
    if (!this.keepHistory) {
      throw new Error("History is not enabled");
    }
    s.increment("write_current_history_index");
    s.if(sql`write_current_history_index = undo_from_history_index`, (s) => {
      s.setScalar("undo_from_history_index", sql.null);
    });
    s.setScalar("write_can_undo", true);
    for (const table of Object.values(this.tables)) {
      applyHistory(s, sql`write_current_history_index`, table);
    }
  }
}

function normalizePartialRowValidation(
  validation: PartialRowValidation | undefined,
): PartialRowValidationOptions | undefined {
  if (!validation) {
    return;
  }
  return validation === true ? {} : validation;
}

function partialRowErrorMessage(options: PartialRowValidationOptions) {
  const message = options.errorMessage ?? sql.lit`Required`;
  return typeof message === "string" ? sql.lit(message) : message;
}

function partialRowFieldValue(recordName: string, field: string) {
  return sql`${sql.ref(recordName)}.${sql.ref(field)}`;
}

function partialRowFields(table: DbBackedTable) {
  return table.fields.filter((field) => !field.shared && field.fieldModel);
}

function partialRowImplicitIgnoredFields(table: DbBackedTable) {
  return new Set([
    ...Object.keys(getOptionalField(table, "insertValues") ?? {}),
    ...Object.keys(getOptionalField(table, "setFields") ?? {}),
  ]);
}

function partialRowAutoIgnoredFields(
  table: DbBackedTable,
  options: PartialRowValidationOptions,
) {
  return new Set([
    ...partialRowImplicitIgnoredFields(table),
    ...(options.ignoreFields ?? []),
  ]);
}

function partialRowFieldByName(
  table: DbBackedTable,
  fieldName: string,
): FormField {
  const field = table.fields.find((field) => field.field === fieldName);
  if (!field?.fieldModel) {
    throw new Error(
      `Field ${fieldName} not found on partial-row validated table ${table.table.name}`,
    );
  }
  if (field.shared) {
    throw new Error(
      `Shared field ${fieldName} cannot be used for partial-row validation on table ${table.table.name}`,
    );
  }
  return field;
}

function partialRowCanBeRequired(field: Field) {
  if (!field.notNull) {
    return false;
  }
  switch (field.type) {
    case "Bool":
    case "Enum":
      return false;
    default:
      return true;
  }
}

function partialRowFieldIsEmpty(field: Field, value: AnyExpr): BooleanExpr {
  switch (field.type) {
    case "ForeignKey":
    case "Bool":
    case "Enum":
      return sql`${value} is null`;
    default:
      return sql`${value} is null or trim(${value}) = ''`;
  }
}

function createPartialRowValidationRow(
  table: DbBackedTable,
  recordName: string,
): PartialRowValidationRow {
  return {
    hasValue: (fieldName) => {
      partialRowFieldByName(table, fieldName);
      return sql`${partialRowFieldValue(recordName, fieldName)} is not null`;
    },
    hasText: (fieldName) => {
      partialRowFieldByName(table, fieldName);
      const value = partialRowFieldValue(recordName, fieldName);
      return sql`${value} is not null and trim(${value}) != ''`;
    },
    isTrue: (fieldName) => {
      partialRowFieldByName(table, fieldName);
      return sql`coalesce(${
        partialRowFieldValue(recordName, fieldName)
      }, false)`;
    },
    changedFromInitial: (fieldName) => {
      const field = partialRowFieldByName(table, fieldName);
      return sql.not(
        isDefaultOrEmpty(
          field.fieldModel!,
          partialRowFieldValue(recordName, fieldName),
          field.initialValue,
        ),
      );
    },
  };
}

function validatePartialRowOptionFields(
  table: DbBackedTable,
  options: PartialRowValidationOptions,
) {
  const implicitIgnored = partialRowImplicitIgnoredFields(table);
  const explicitIgnored = new Set(options.ignoreFields ?? []);
  for (const fieldName of explicitIgnored) {
    if (!implicitIgnored.has(fieldName)) {
      partialRowFieldByName(table, fieldName);
    }
  }
  for (const fieldName of options.required ?? []) {
    if (explicitIgnored.has(fieldName)) {
      throw new Error(
        `Field ${fieldName} cannot be both required and ignored on partial-row validated table ${table.table.name}`,
      );
    }
    partialRowFieldByName(table, fieldName);
  }
}

function partialRowDefaultActiveExpr(
  table: DbBackedTable,
  recordName: string,
  options: PartialRowValidationOptions,
): BooleanExpr {
  const ignored = partialRowAutoIgnoredFields(table, options);
  const fieldNames = new Set<string>();
  for (const field of partialRowFields(table)) {
    if (!ignored.has(field.field)) {
      fieldNames.add(field.field);
    }
  }
  if (fieldNames.size === 0) {
    return sql.false;
  }
  return sql.or(
    ...Array.from(fieldNames).map((fieldName) => {
      const field = partialRowFieldByName(table, fieldName);
      return sql.not(
        isDefaultOrEmpty(
          field.fieldModel!,
          partialRowFieldValue(recordName, fieldName),
          field.initialValue,
        ),
      );
    }),
  );
}

function partialRowOwnActiveExpr(
  table: DbBackedTable,
  recordName: string,
  options: PartialRowValidationOptions,
) {
  if (options.activeWhen) {
    return options.activeWhen(createPartialRowValidationRow(table, recordName));
  }
  return partialRowDefaultActiveExpr(table, recordName, options);
}

function partialRowChildActiveExpr(table: DbBackedTable, recordName: string) {
  const relationExprs: BooleanExpr[] = [];
  for (const relation of table.relations) {
    if (relation.type === "temporary" || !relation.validatePartialRows) {
      continue;
    }
    const options = normalizePartialRowValidation(relation.validatePartialRows);
    if (!options || !isManyTable(relation)) {
      continue;
    }
    const relationRecordName = `${relation.stateName}_partial_child_record`;
    const relationTableIdent = sql.ref(`ui.${relation.stateName}`);
    const relationRecordIdent = sql.ref(relationRecordName);
    const recordIdent = sql.ref(recordName);
    relationExprs.push(sql`exists (
      select 1
      from ${relationTableIdent} as ${relationRecordIdent}
      where ${relationRecordIdent}.parent_write_ui_id = ${recordIdent}.write_ui_id
        and ${partialRowActiveExpr(relation, relationRecordName, options)}
    )`);
  }
  return relationExprs.length === 0 ? sql.false : sql.or(...relationExprs);
}

function partialRowActiveExpr(
  table: DbBackedTable,
  recordName: string,
  options: PartialRowValidationOptions,
) {
  return sql.or(
    partialRowOwnActiveExpr(table, recordName, options),
    partialRowChildActiveExpr(table, recordName),
  );
}

function partialRowRequiredFields(
  table: DbBackedTable,
  options: PartialRowValidationOptions,
) {
  if (options.required) {
    return new Set(options.required);
  }
  const ignored = partialRowAutoIgnoredFields(table, options);
  return new Set(
    partialRowFields(table)
      .filter((field) =>
        !ignored.has(field.field) &&
        partialRowCanBeRequired(field.fieldModel!)
      )
      .map((field) => field.field),
  );
}

function partialRowErrorAssignments(
  table: DbBackedTable,
  recordName: string,
  options: PartialRowValidationOptions,
) {
  const requiredFields = partialRowRequiredFields(table, options);
  const errorMessage = partialRowErrorMessage(options);
  return partialRowFields(table)
    .filter((field) =>
      requiredFields.has(field.field) ||
      partialRowCanBeRequired(field.fieldModel!)
    )
    .map((field) => {
      const errorField = sql.ref(`${field.field}_write_error`);
      const recordErrorField = sql`${sql.ref(recordName)}.${errorField}`;
      const isRequired = requiredFields.has(field.field);
      const emptyField = isRequired
        ? partialRowFieldIsEmpty(
          field.fieldModel!,
          partialRowFieldValue(recordName, field.field),
        )
        : sql.false;
      return updateAssignment(
        errorField,
        sql`case
        when ${emptyField} then ${errorMessage}
        when ${recordErrorField} = ${errorMessage}
          or ${recordErrorField} = 'Required' then null
        else ${recordErrorField}
      end`,
      );
    });
}

/**
 * Helper bound to a single-record form table. Exposes the table's SQL
 * identifier and a `.field(name)` factory that returns a typed
 * {@link FormFieldHelper} for reading / mutating one of the table's
 * fields. Obtain one via the surrounding form helpers or
 * `useCurrentTableHelper()`.
 */
export class RecordHelper {
  constructor(
    private readonly keepHistory: boolean,
    private readonly historyThrottleTime: number,
    /** The form table this helper is bound to. */
    public table: FormTable,
  ) {}

  get ident() {
    return sql.ref(this.table.stateName);
  }

  field(name: string) {
    return createFieldHelper(
      this.keepHistory,
      this.historyThrottleTime,
      this.table.stateName,
      sql.ref(this.table.stateName),
      name,
    );
  }
}

/**
 * Helper bound to a many-rows form table (`insertMany` / `updateMany` /
 * `mergeMany` / temporary). Provides record management (`addRecord`,
 * `removeRecord`, iteration) and a `.cursor` accessor that returns a
 * {@link CursorHelper} for the current row.
 */
export class TableHelper {
  constructor(
    public keepHistory: boolean,
    public historyThrottleTime: number,
    /** The form table this helper is bound to. */
    public table: FormTable,
  ) {}

  get tableIdent() {
    return sql.ref(this.table.stateName);
  }

  #addRecordInner<T extends IStatementsBase>(
    s: T,
    fields: Record<string, AnyExpr> | undefined,
    parentUiId?: AnyExpr,
  ) {
    const resolvedFields = fields ?? {};
    if (!isManyTable(this.table)) {
      throw new Error("Cannot add record to non-many table");
    }
    const columns = ["write_ui_id"];
    const values: AnyExpr[] = [sql`ui.next_write_id`];
    if (parentUiId) {
      columns.push("parent_write_ui_id");
      values.push(parentUiId!);
    }
    for (const field of this.table.fields) {
      if (field.shared) {
        continue;
      }
      columns.push(field.field);
      columns.push(`${field.field}_write_touched`);
      values.push(resolvedFields[field.field] ?? field.initialValue);
      values.push(false);
    }
    s.modify(sql.insertValues(this.table.stateName, columns, values));
    s.increment("ui.next_write_id");
  }

  get hasAnyError() {
    const fieldErrors = this.table.fields
      .filter((f) => !f.shared)
      .map((f) => sql`${sql(f.field)}_write_error is not null`);
    return sql`exists (select 1 from ${sql.ref(this.table.stateName)} where ${
      sql.or(...fieldErrors)
    } or write_record_error is not null)`;
  }

  copyRecursiveToHistoryTable<T extends IStatementsBase>(s: T) {
    function copyRecursive(s: T, table: FormTable) {
      copyToHistoryTable(s, table.stateName);
      for (const relation of table.relations) {
        copyRecursive(s, relation);
      }
    }
    copyRecursive(s, this.table);
  }

  addRecord<T extends IStatementsBase>(
    s: T,
    fields: Record<string, AnyExpr> | undefined,
    parentUiId?: AnyExpr,
  ) {
    this.#addRecordInner(s, fields, parentUiId);
    if (this.keepHistory) {
      addHistory(s, {
        throttleTime: this.historyThrottleTime,
        forceAdd: true,
        doCopy: (s) => {
          copyToHistoryTable(s, this.table.stateName);
        },
      });
    }
  }

  addRecordWithRelations<T extends IStatementsBase>(
    s: T,
    fields: Record<string, AnyExpr> | undefined,
    relations: Record<string, Record<string, AnyExpr>[]> | undefined,
    parentUiId?: AnyExpr,
  ) {
    const resolvedRelations = relations ?? {};
    s.defScalar(`${this.table.stateName}_next_write_id`, {
      expr: sql`ui.next_write_id`,
      allowNoRead: true,
    });
    this.#addRecordInner(s, fields, parentUiId);
    for (
      const [relationName, relationFields] of Object.entries(
        resolvedRelations,
      )
    ) {
      const relationTable = this.table.relations.find(
        (r) =>
          r.stateName === relationName ||
          ("table" in r && r.table.name === relationName),
      );
      if (!relationTable) {
        throw new Error(`Relation ${relationName} not found`);
      }
      const relationHelper = new TableHelper(
        this.keepHistory,
        this.historyThrottleTime,
        relationTable,
      );
      for (const fields of relationFields) {
        relationHelper.#addRecordInner(
          s,
          fields,
          sql.ref(`${this.table.stateName}_next_write_id`),
        );
      }
    }
    if (this.keepHistory) {
      addHistory(s, {
        throttleTime: this.historyThrottleTime,
        forceAdd: true,
        doCopy: (s) => {
          this.copyRecursiveToHistoryTable(s);
        },
      });
    }
  }

  deleteAllRecords<T extends IStatementsBase>(s: T) {
    s.modify(sql`delete from ${sql.ref(this.table.stateName)}`);
    if (this.keepHistory) {
      addHistory(s, {
        throttleTime: this.historyThrottleTime,
        forceAdd: true,
        doCopy: (s) => {
          this.copyRecursiveToHistoryTable(s);
        },
      });
    }
  }
}

/**
 * Helper bound to the current iteration of a {@link TableHelper}, scoped
 * to a single row. Returned from {@link useCursorHelper} inside
 * `<WriteEach>` blocks. Exposes `.field(name)` for the current row and
 * the iteration index.
 */
export class CursorHelper {
  #helper: TableHelper;

  constructor(
    private readonly keepHistory: boolean,
    private readonly historyThrottleTime: number,
    /** The form table being iterated. */
    public table: FormTable,
    /** SQL record name bound to the current iteration. */
    public recordName: string,
    private readonly where?: BooleanExpr,
    private readonly isSubmittingExpr: BooleanExpr = sql.false,
  ) {
    this.#helper = new TableHelper(keepHistory, historyThrottleTime, table);
  }

  get iterationIndex() {
    return sql`${sql.ref(this.recordName)}.iteration_index`;
  }

  get isLast() {
    return sql`${this.iterationIndex} = (select count(*) from ${
      sql.ref(this.table.stateName)
    } where ${this.where ?? sql.true}) - 1`;
  }

  get isSubmitting() {
    return this.isSubmittingExpr;
  }

  get recordIdent() {
    return sql.ref(this.recordName);
  }

  get recordUiId() {
    return sql`${this.recordIdent}.write_ui_id`;
  }

  get recordDbId() {
    return sql`${this.recordIdent}.write_db_id`;
  }

  addRecord<T extends IStatementsBase>(s: T, values: Record<string, AnyExpr>) {
    this.#helper.addRecord(s, values);
    if (this.keepHistory) {
      addHistory(s, {
        throttleTime: this.historyThrottleTime,
        forceAdd: true,
        doCopy: (s) => {
          copyToHistoryTable(s, this.table.stateName);
        },
      });
    }
  }

  delete<T extends IStatementsBase>(s: T) {
    s.modify(sql`delete from ${sql.ref(this.recordName)}`);
    if (this.keepHistory) {
      addHistory(s, {
        throttleTime: this.historyThrottleTime,
        forceAdd: true,
        doCopy: (s) => {
          this.#helper.copyRecursiveToHistoryTable(s);
        },
      });
    }
  }

  duplicate<T extends IStatementsBase>(s: T) {
    const id = `${this.table.stateName}_next_write_id`;
    s.defScalar(id, { expr: sql`ui.next_write_id`, allowNoRead: true });
    const values: AnyExpr[] = [sql.ref(id)];
    const fields = ["write_ui_id"];
    if (this.table.parent) {
      fields.push("parent_write_ui_id");
      values.push(sql`${this.recordIdent}.parent_write_ui_id`);
    }
    for (const field of this.table.fields) {
      values.push(sql`${this.recordIdent}.${sql.ref(field.field)}`);
      fields.push(field.field);
    }
    s.modify(sql.insertValues(sql.ref(this.table.stateName), fields, values));
    s.increment("ui.next_write_id");
    const copyRelation = (
      s: T,
      newParentId: AnyExpr,
      oldParentId: AnyExpr,
      table: FormTable,
    ) => {
      s.forEachQuery(
        sql`select * from ${sql.ref(table.stateName)} where ${
          sql.ref("parent_write_ui_id")
        } = ${oldParentId}`,
        "record_name",
        (s) => {
          s.defScalar(`${table.stateName}_prev_write_id`, {
            expr: sql`record_name.write_ui_id`,
            allowNoRead: true,
          });
          s.defScalar(`${table.stateName}_next_write_id`, {
            expr: sql`ui.next_write_id`,
            allowNoRead: true,
          });
          const values: AnyExpr[] = [sql`ui.next_write_id`, newParentId];
          const fields = ["write_ui_id", "parent_write_ui_id"];
          for (const field of table.fields) {
            values.push(sql`record_name.${sql.ref(field.field)}`);
            fields.push(field.field);
          }
          s.modify(sql.insertValues(sql.ref(table.stateName), fields, values));
          s.increment("ui.next_write_id");
          for (const relation of table.relations) {
            copyRelation(
              s,
              sql.ref(`${table.stateName}_next_write_id`),
              sql.ref(`${table.stateName}_prev_write_id`),
              relation,
            );
          }
        },
      );
    };
    for (const relation of this.table.relations) {
      copyRelation(s, sql.ref(id), this.recordUiId, relation);
    }
    if (this.keepHistory) {
      addHistory(s, {
        throttleTime: this.historyThrottleTime,
        forceAdd: true,
        doCopy: (s) => {
          this.#helper.copyRecursiveToHistoryTable(s);
        },
      });
    }
  }

  field(name: string) {
    return createFieldHelper(
      this.keepHistory,
      this.historyThrottleTime,
      this.table.stateName,
      this.recordIdent,
      name,
    );
  }

  setEmpty<T extends IStatementsBase>(s: T) {
    for (const field of this.table.fields) {
      this.field(field.field).setValue(s, field.initialValue);
    }
  }

  isNotEmpty() {
    return sql.or(
      ...this.table.fields.map((f) => {
        const fieldModel = f.fieldModel;
        if (!fieldModel) {
          return true;
        }
        return sql.not(
          isDefaultOrEmpty(
            fieldModel,
            sql.ref(this.recordIdent, f.field),
            f.initialValue,
          ),
        );
      }),
    );
  }

  isEmpty() {
    return sql.and(
      ...this.table.fields.map((f) => {
        const fieldModel = f.fieldModel;
        if (!fieldModel) {
          return true;
        }
        return isDefaultOrEmpty(
          fieldModel,
          sql.ref(this.recordIdent, f.field),
          f.initialValue,
        );
      }),
    );
  }
}

class WriteStackCtx implements ContextInstance, FormStackICtx {
  implementICtxs = [FormStackICtxKey];

  constructor(public stack: FormStackFrame[]) {}
}

function extendWriteStackCtx(frame: FormStackFrame) {
  addCtx(
    new WriteStackCtx([
      ...(useOptionalICtx(FormStackICtxKey)?.stack ?? []),
      frame,
    ]),
  );
}

function defineFormTables(
  s: StateStatements,
  table: FormTable,
  keepHistory: boolean,
) {
  const fields: HelperProcField[] = [
    {
      name: "write_record_error",
      type: "String",
    },
    {
      name: "write_ui_id",
      type: "BigUint",
    },
  ];
  if (
    table.type === "update" ||
    table.type === "merge" ||
    table.type === "updateMany" ||
    table.type === "mergeMany"
  ) {
    fields.push({
      name: "write_db_id",
      type: "BigUint",
    });
  }
  if (table.parent) {
    fields.push({
      name: "parent_write_ui_id",
      type: "BigUint",
    });
  }
  if ("optional" in table && table.optional) {
    fields.push({
      name: "write_relation_exists",
      type: "Bool",
    });
  }
  let hasSharedFields = false;
  for (const field of table.fields) {
    if (field.shared) {
      hasSharedFields = true;
      continue;
    }
    if (table.type === "temporary") {
      if (!field.fieldType) {
        throw new Error(`Field ${field.field} has no type`);
      }
      fields.push({
        name: field.field,
        type: field.fieldType,
      });
    } else {
      const fieldModel = table.table!.fields[field.field];
      if (!fieldModel) {
        throw new Error(
          `Field ${field.field} not found in table ${table.table!.name}`,
        );
      }
      fields.push({
        name: field.field,
        type: formFieldType(fieldModel),
      });
    }
    fields.push({
      name: `${field.field}_write_error`,
      type: "String",
    });
    fields.push({
      name: `${field.field}_write_touched`,
      type: "Bool",
    });
  }
  if (keepHistory) {
    s.defTable(`${table.stateName}_write_history`, {
      fields: [
        ...fields,
        {
          name: "write_history_index",
          type: "BigUint" as const,
          notNull: true,
        },
      ],
    });
  }
  if (hasSharedFields) {
    if (keepHistory) {
      throw new Error("Keep history is not supported for shared fields yet");
    }
    if (table.type === "temporary") {
      throw new Error("Shared fields are not supported for temporary tables");
    }
    const sharedFields: HelperProcField[] = [];
    for (const field of table.fields) {
      if (!field.shared) {
        continue;
      }
      const fieldModel = table.table!.fields[field.field];
      if (!fieldModel) {
        throw new Error(
          `Field ${field.field} not found in table ${table.table!.name}`,
        );
      }
      sharedFields.push({
        name: field.field,
        type: formFieldType(fieldModel),
      });
      sharedFields.push({
        name: `${field.field}_write_error`,
        type: "String",
      });
      sharedFields.push({
        name: `${field.field}_write_touched`,
        type: "Bool",
      });
    }
    s.defRecord(`${table.stateName}_shared_fields`, {
      fields: sharedFields,
    });
  }
  if (isManyTable(table)) {
    s.defTable(table.stateName, {
      fields,
    });
    if (hasInitialDbIdsTable(table)) {
      s.defTable(initialDbIdsTableName(table), {
        fields: [{ name: "id", type: "BigUint", notNull: true }],
      });
    }
  } else {
    s.defRecord(table.stateName, {
      fields,
    });
  }
  for (const relation of table.relations) {
    defineFormTables(s, relation, keepHistory);
  }
}

function copyToHistoryTable<T extends IStatementsBase>(s: T, table: string) {
  const historyTable = sql.ref(`${table}_write_history`);
  s.modify(
    sql`delete from ${historyTable} where write_history_index = write_current_history_index`,
  );
  s.modify(
    sql`insert into ${historyTable} select *, write_current_history_index as write_history_index from ${
      sql.ref(table)
    }`,
  );
}

function initialDbIdsTableName(table: FormTableMergeMany) {
  return `${table.stateName}_initial_db_ids`;
}

function hasInitialDbIdsTable(
  table: FormTable,
): table is FormTableMergeMany {
  return table.type === "mergeMany" && table.deleteBehavior === "initial";
}

function createInitialHistoryEntry(s: StateStatements, table: FormTable) {
  copyToHistoryTable(s, table.stateName);
  for (const relation of table.relations) {
    createInitialHistoryEntry(s, relation);
  }
}

function applyHistory<T extends IStatementsBase>(
  s: T,
  idx: NumericExpr,
  table: FormTable,
) {
  s.block((s) => {
    s.modify(sql`delete from ${sql.ref(table.stateName)}`);
    s.defScalar(
      "last_history_index",
      sql`(select max(write_history_index) from ${
        sql.ref(`${table.stateName}_write_history`)
      } where write_history_index <= ${idx})`,
    );
    s.modify(
      sql`insert into ${sql.ref(table.stateName)} select * from ${
        sql.ref(`${table.stateName}_write_history`)
      } where write_history_index = last_history_index`,
    );
    for (const relation of table.relations) {
      applyHistory(s, idx, relation);
    }
  });
}

function insertSharedFields(s: StateStatements, table: DbBackedTable) {
  if (!table.fields.some((f) => f.shared)) {
    return;
  }
  const insertFields: string[] = [];
  const insertValues: AnyExpr[] = [];
  for (const field of table.fields) {
    if (!field.shared) {
      continue;
    }
    insertFields.push(field.field);
    insertFields.push(`${field.field}_write_touched`);
    const fieldModel = table.table?.fields[field.field];
    if (!fieldModel) {
      throw new Error(
        `Field ${field.field} not found in table ${table.table?.name}`,
      );
    }
    insertValues.push(field.initialValue);
    insertValues.push(false);
  }
  s.modify(
    sql.insertValues(
      sql.ref(`ui.${table.stateName}_shared_fields`),
      insertFields,
      insertValues,
    ),
  );
}

function initializeInsertTable(
  s: StateStatements,
  table: FormTable,
  parentUiId?: AnyExpr,
) {
  if ("initializeSource" in table && table.initializeSource) {
    s.forEachQuery(
      table.initializeSource,
      `${table.stateName}_source_record`,
      (s) => {
        const insertFields: string[] = ["write_ui_id"];
        const insertValues: AnyExpr[] = [sql`next_write_id`];
        if (table.parent) {
          insertFields.push("parent_write_ui_id");
          insertValues.push(parentUiId!);
        }
        for (const field of table.fields) {
          if (field.shared) {
            continue;
          }
          if (table.initializeValues?.[field.field]) {
            insertFields.push(field.field);
            insertFields.push(`${field.field}_write_touched`);
            insertValues.push(table.initializeValues[field.field]);
            insertValues.push(false);
            continue;
          }
          insertFields.push(field.field);
          insertFields.push(`${field.field}_write_touched`);
          const fieldModel = table.table?.fields[field.field];
          if (!fieldModel) {
            throw new Error(
              `Field ${field.field} not found in table ${table.table?.name}`,
            );
          }
          insertValues.push(field.initialValue);
          insertValues.push(false);
        }
        if (table.relations.length > 0) {
          s.defScalar(`parent_${table.stateName}_ui_id`, {
            expr: sql`next_write_id`,
            allowNoRead: true,
          });
        }
        s.modify(
          sql.insertValues(
            sql.ref(`ui.${table.stateName}`),
            insertFields,
            insertValues,
          ),
        );
        s.increment("next_write_id");
        for (const relation of table.relations) {
          initializeFormTables(
            s,
            relation,
            undefined,
            sql.ref(`parent_${table.stateName}_ui_id`),
          );
        }
      },
    );
    return;
  }
  const insertFields: string[] = ["write_ui_id"];
  const insertValues: AnyExpr[] = [sql`next_write_id`];
  if (table.optional) {
    insertFields.push("write_relation_exists");
    insertValues.push(table.optionalExistsByDefault ?? false);
  }
  if (table.parent) {
    insertFields.push("parent_write_ui_id");
    insertValues.push(parentUiId!);
  }
  for (const field of table.fields) {
    if (field.shared) {
      continue;
    }
    insertFields.push(field.field);
    insertFields.push(`${field.field}_write_touched`);
    if (table.type === "temporary") {
      insertValues.push(field.initialValue ?? sql`null`);
    } else {
      const fieldModel = table.table?.fields[field.field];
      if (!fieldModel) {
        throw new Error(
          `Field ${field.field} not found in table ${table.table?.name}`,
        );
      }
      insertValues.push(field.initialValue);
    }
    insertValues.push(false);
  }
  if (table.relations.length > 0) {
    s.defScalar(`parent_${table.stateName}_ui_id`, {
      expr: sql`next_write_id`,
      allowNoRead: true,
    });
  }
  s.modify(
    sql.insertValues(
      sql.ref(`ui.${table.stateName}`),
      insertFields,
      insertValues,
    ),
  );
  s.increment("next_write_id");
  for (const relation of table.relations) {
    initializeFormTables(
      s,
      relation,
      undefined,
      sql.ref(`parent_${table.stateName}_ui_id`),
    );
  }
}

function initializeFormTables(
  s: StateStatements,
  table: FormTable,
  parentDbId?: AnyExpr,
  parentUiId?: AnyExpr,
) {
  if ("dontInitialize" in table && table.dontInitialize) {
    return;
  }
  if (isManyTable(table)) {
    if (table.type === "updateMany" || table.type === "mergeMany") {
      let whereClause: BooleanExpr = sql.true;
      if (table.parent && table.relationField) {
        // This means that we are in a relation of an insert, so we can't have a parentDbId
        // For now we will not initialize this table, but we might make this configurable in the future
        if (!parentDbId) {
          return;
        }
        whereClause = sql`${table.relationField.ident} = ${parentDbId}`;
      }
      if (table.where) {
        whereClause = sql.and(whereClause, table.where);
      }
      const rowIdent = `${table.stateName}_source_record`;
      s.forEachQuery(
        table.initializeSource ??
          sql`select * from ${table.table!.identWithDb} where ${whereClause}`,
        rowIdent,
        (s) => {
          const insertFields = table.fields.flatMap((f) => [
            f.field,
            `${f.field}_write_touched`,
          ]);
          insertFields.push("write_db_id");
          insertFields.push("write_ui_id");
          const insertValues: AnyExpr[] = table.fields.flatMap((f) => {
            const expr = sql`${sql.ref(rowIdent)}.${sql.ref(f.field)}`;
            if (table.initializeValues?.[f.field]) {
              return [table.initializeValues[f.field], false];
            }
            return [
              f.fieldModel ? getFormValueFromDbValue(f.fieldModel, expr) : expr,
              false,
            ];
          });
          insertValues.push(
            sql`${sql.ref(rowIdent)}.${table.table!.primaryKeyIdent}`,
          );
          insertValues.push(sql`next_write_id`);
          if (table.parent) {
            insertFields.push("parent_write_ui_id");
            insertValues.push(parentUiId!);
          }
          s.modify(
            sql.insertValues(
              sql.ref(`ui.${table.stateName}`),
              insertFields,
              insertValues,
            ),
          );
          if (hasInitialDbIdsTable(table)) {
            const initialDbId = sql`${sql.ref(rowIdent)}.${
              table.table!.primaryKeyIdent
            }`;
            s.modify(
              sql`insert into ui.${
                sql.ref(initialDbIdsTableName(table))
              } (id) select ${initialDbId} where ${initialDbId} is not null`,
            );
          }
          if (table.relations.length > 0) {
            s.defScalar(
              `parent_${table.stateName}_db_id`,
              sql`${sql.ref(rowIdent)}.${table.table!.primaryKeyIdent}`,
            );
            s.defScalar(`parent_${table.stateName}_ui_id`, sql`next_write_id`);
          }
          s.increment("next_write_id");
          for (const relation of table.relations) {
            initializeFormTables(
              s,
              relation,
              sql.ref(`parent_${table.stateName}_db_id`),
              sql.ref(`parent_${table.stateName}_ui_id`),
            );
          }
        },
      );
      if (table.type === "mergeMany" && table.defaultEmptyRecord) {
        s.if(
          sql`not exists (select 1 from ${
            table.table!.identWithDb
          } where ${whereClause})`,
          (s) => {
            initializeInsertTable(s, table, parentUiId);
          },
        );
      }
    }
    if (table.type === "insertMany") {
      insertSharedFields(s, table);
      initializeInsertTable(s, table, parentUiId);
    }
    return;
  }
  if (table.type === "update" || table.type === "merge") {
    let whereClause: BooleanExpr = sql.true;
    if (table.where) {
      whereClause = sql.and(whereClause, table.where);
    }
    if (table.fkDirection === "parentToChild") {
      const tableModel = (table as DbBackedTable).table;
      const parentTableModel = (table.parent as DbBackedTable).table;
      whereClause = sql.and(
        whereClause,
        sql`${tableModel!.primaryKeyIdent} = (select ${
          table.relationField!.ident
        } from ${parentTableModel!.identWithDb} where ${
          parentTableModel!.primaryKeyIdent
        } = ${parentDbId!})`,
      );
    }
    s.defRecord(
      `initial_record_${table.stateName}`,
      sql`select * from ${table.table!.identWithDb} where ${whereClause}`,
    );
    const initialRecordIdent = sql.ref(`initial_record_${table.stateName}`);
    const insertFields: string[] = ["write_db_id", "write_ui_id"];
    const insertValues: AnyExpr[] = [
      sql`${initialRecordIdent}.${table.table!.primaryKeyIdent}`,
      sql`next_write_id`,
    ];
    if (table.parent) {
      insertFields.push("parent_write_ui_id");
      insertValues.push(parentUiId!);
    }
    if (table.optional) {
      insertFields.push("write_relation_exists");
      insertValues.push(
        sql`${sql.ref(`initial_record_${table.stateName}`)}.${
          table.table!.primaryKeyIdent
        } is not null`,
      );
    }
    for (const field of table.fields) {
      insertFields.push(field.field);
      insertFields.push(`${field.field}_write_touched`);
      const fieldModel = table.table!.fields[field.field];
      if (!fieldModel) {
        throw new Error(
          `Field ${field.field} not found in table ${table.table!.name}`,
        );
      }
      const expr = sql`${initialRecordIdent}.${sql.ref(field.field)}`;
      insertValues.push(
        field.fieldModel
          ? getFormValueFromDbValue(field.fieldModel, expr)
          : expr,
      );
      insertValues.push(false);
    }
    const doInitialize = (s: StateStatements) => {
      s.modify(
        sql.insertValues(
          sql.ref(`ui.${table.stateName}`),
          insertFields,
          insertValues,
        ),
      );
      if (table.relations.length > 0) {
        s.defScalar(
          `parent_${table.stateName}_db_id`,
          sql`${initialRecordIdent}.${
            (table as DbBackedTable).table!.primaryKeyIdent
          }`,
        );
        s.defScalar(`parent_${table.stateName}_ui_id`, sql`next_write_id`);
      }
      s.increment("next_write_id");
      for (const relation of table.relations) {
        initializeFormTables(
          s,
          relation,
          sql.ref(`parent_${table.stateName}_db_id`),
          sql.ref(`parent_${table.stateName}_ui_id`),
        );
      }
    };
    if ("defaultEmptyRecord" in table && table.defaultEmptyRecord) {
      s.conditional({
        condition: sql`initial_record_${sql(table.stateName)}.${
          table.table!.primaryKeyIdent
        } is null`,
        then: (s) => {
          initializeInsertTable(s, table, parentUiId);
        },
        else: (s) => {
          doInitialize(s);
        },
      });
    } else {
      doInitialize(s);
    }
  } else {
    initializeInsertTable(s, table, parentUiId);
  }
}

/**
 * Hooks tapped at every phase of a server-backed form submission. Used
 * by {@link FormProps} (where the extra args are the form context) and by
 * lower-level helpers that need to inject behavior before/after the
 * server transaction. The hooks are called in the documented order:
 *
 * 1. `beforeSubmitClient` (DOM)
 * 2. `beforeTransactionStart` (server)
 * 3. `afterTransactionStart` (server, inside transaction)
 * 4. {form writes}
 * 5. `beforeTransactionCommit` (server, inside transaction)
 * 6. `afterTransactionCommit` (server, after commit)
 * 7. `afterSubmitClientSuccess` (DOM) — or `onSubmitError` if any step
 *    failed
 */
export interface ServerTransactionsProcExtensions<T extends any[]> {
  /**
       Runs before the service proc starts.
       You can set errors in the form state here and we will not start the service proc if there are errors.
       @param s - The DOM statements object for manipulating the client-side DOM.
       @param ctx - The write context containing information about the current write operation.
       */
  beforeSubmitClient?: (s: DomStatements, ...args: T) => unknown;

  /**
       Runs on the data service before the start of the transaction.
       You can set errors in the form state here and we will not run the transaction if there are errors
       and instead return the error to the client.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  beforeTransactionStart?: (s: UiServerStatements, ...args: T) => unknown;

  /**
       Runs after the start of the transaction.
       Here you can set up any variables you would like to use in the body of the transaction
       or you can just do some additional updates or inserts or deletes.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  afterTransactionStart?: (s: UiServerStatements, ...args: T) => unknown;

  /**
       Runs after the body of the transaction but before the commit.
       This lets you reference anything done in the transaction body. For example, if you insert a record
       and need to reference the id of the record for an insert into another table, you can do that here.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  beforeTransactionCommit?: (s: UiServerStatements, ...args: T) => unknown;

  /**
       Runs after the commit of the transaction.
       This lets you reference anything done and committed in the transaction body.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  afterTransactionCommit?: (s: UiServerStatements, ...args: T) => unknown;

  /**
       Runs on the client after the service procedure has completed successfully.
       @param s - The DOM statements object for manipulating the client-side DOM.
       @param ctx - The write context containing information about the current write operation.
       */
  afterSubmitClientSuccess?: (s: DomStatements, ...args: T) => unknown;
}

/**
 * Interface for extending the form submission procedure with custom hooks.
 *
 * Hook execution order on successful submission:
 * `beforeSubmitClient` (client) -> `beforeTransactionStart` (server) -> `afterTransactionStart` (server) ->
 * [form writes] -> `beforeTransactionCommit` (server) -> commitTransaction -> `afterTransactionCommit` (server) ->
 * `afterSubmitClientSuccess` (client)
 *
 * If any error occurs at any stage, `onSubmitError` runs on the client.
 */
export interface WriteProcExtensions {
  /**
       Runs before the service proc starts.
       You can set errors in the form state here and we will not start the service proc if there are errors.
       @param s - The DOM statements object for manipulating the client-side DOM.
       @param ctx - The write context containing information about the current write operation.
       */
  beforeSubmitClient?: (s: DomStatements, ctx: FormContext) => unknown;

  /**
       Runs on the data service before the start of the transaction.
       You can set errors in the form state here and we will not run the transaction if there are errors
       and instead return the error to the client.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  beforeTransactionStart?: (
    s: UiServerStatements,
    ctx: FormContext,
  ) => unknown;

  /**
       Runs after the start of the transaction.
       Here you can set up any variables you would like to use in the body of the transaction
       or you can just do some additional updates or inserts or deletes.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  afterTransactionStart?: (s: UiServerStatements, ctx: FormContext) => unknown;

  /**
       Runs after the body of the transaction but before the commit.
       This lets you reference anything done in the transaction body. For example, if you insert a record
       and need to reference the id of the record for an insert into another table, you can do that here.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  beforeTransactionCommit?: (
    s: UiServerStatements,
    ctx: FormContext,
  ) => unknown;

  /**
       Runs after the commit of the transaction.
       This lets you reference anything done and committed in the transaction body.
       @param s - The UI server statements object for server-side operations.
       @param ctx - The write context containing information about the current write operation.
       */
  afterTransactionCommit?: (
    s: UiServerStatements,
    ctx: FormContext,
  ) => unknown;

  /**
       Runs on the client after the service procedure has completed successfully.
       @param s - The DOM statements object for manipulating the client-side DOM.
       @param ctx - The write context containing information about the current write operation.
       */
  afterSubmitClientSuccess?: (s: DomStatements, ctx: FormContext) => unknown;

  /**
       Runs on the client after any error is set after submitting the form. This doesn't mean that
       the write went to the server, it just means that there was an error and could be client side only.
   */
  onSubmitError?: (s: DomStatements, ctx: FormContext) => unknown;
  /**
   * Runs when the server submission catches an error. Setting a field or write
   * error handles the failure; otherwise the original error is rethrown.
   */
  onSubmitServerError?: (
    s: UiServerStatements,
    ctx: FormContext,
    err: FormSubmitError,
  ) => unknown;
}

/**
 * Props for the {@link Form} component. Configures the form's children,
 * lifecycle hooks (via {@link ServerTransactionsProcExtensions}), undo
 * history, dirty-check behavior, and submission triggers.
 *
 * See {@link https://docs.yolm.io/ui/form | Form} for the high-level
 * narrative.
 */
export interface FormProps extends WriteProcExtensions {
  /** The child nodes to be rendered within the Write component. */
  children: Node;
  /**
       The default component to be used for rendering form fields.
       If not provided, a default implementation will be used.
       */
  defaultFieldComponent?: Component<any>;
  /**
       If true, the form will be submitted when the Enter key with Ctrl or Cmd is pressed anywhere in the document.
       @default false
       */
  submitOnDocumentEnterPlusCtrlOrCmd?: boolean;

  /**
       If true, the form will be submitted when the Enter key but not on shift + Enter is pressed anywhere in the document.
       @default false
       */
  submitOnDocumentEnter?: boolean;
  /**
       Renders a different node other than the children after the write operation is successful.
       */
  afterSuccessNode?: Node;
  /**
       Puts this watch on the state for the form.

       This is useful if you want to restart the form when something changes.
       */
  watch?: AnyExpr | AnyExpr[];
  /**
       If true, a check will be done before the page is unloaded to see if the form has changed.
       If it has, the user will be prompted to save the form before leaving.
       @default false
       */
  beforeUnloadCheck?: boolean;
  /**
       If true, the write will keep a history of the values.

       This is useful if you want to be able to undo/redo changes.

       This is done by creating parallel tables with a suffix of `_write_history`, which will be written to
       whenever you make a change via one of the helper functions.

       @default false
       */
  keepHistory?: boolean;
  /**
       If keepHistory is true, this is the number of milliseconds to throttle the history updates.

       @default 3_000
       */
  historyThrottle?: number;
  /** Name of the scalar that holds the form state's load status. Auto-generated if omitted. */
  statusScalar?: string;
  /** Name of the scalar that tracks whether the form state has loaded data. Auto-generated if omitted. */
  hasDataScalar?: string;
  /** Name of the record that captures a load error for the form state. */
  errorRecord?: string;
  /**
   * If true, `s.refetch()` is called after a successful submit,
   * triggering all non-local ancestor `Data` components to refresh.
   * @default true
   */
  refetchOnSuccess?: boolean;
}

function resolveGatheredTable(
  resolvedTables: Map<string, FormTable>,
  table: GatherFormTable,
): FormTable {
  if (resolvedTables.has(table.stateName)) {
    return resolvedTables.get(table.stateName)!;
  }
  if (table.type === "indirect") {
    throw new Error(`Indirect table ${table.stateName} was only defined once`);
  }
  const resolvedTable: FormTable = {
    ...table,
    fields: table.fields,
    relations: [],
    parent: undefined,
  };
  if ("filterEmptyRecords" in table && table.filterEmptyRecords) {
    (resolvedTable as FormTableMerge).filterBeforeSubmit = sql.and(
      (resolvedTable as FormTableMerge).filterBeforeSubmit ?? true,
      sql.or(
        ...table.fields.map((f) => {
          const fieldModel = f.fieldModel;
          if (!fieldModel) {
            return true;
          }
          return sql.not(
            isDefaultOrEmpty(fieldModel, sql.ref(f.field), f.initialValue),
          );
        }),
      ),
    );
  }
  resolvedTables.set(table.stateName, resolvedTable);
  resolvedTable.relations = table.relations.map((r) =>
    resolveGatheredTable(resolvedTables, r)
  );
  resolvedTable.parent = table.parent
    ? resolveGatheredTable(resolvedTables, table.parent)
    : undefined;
  return resolvedTable;
}

/**
 * The Form component manages form submissions, validation, and database mutations. Import from `std/form`.
 *
 * Key sub-components:
 * - `Form.Insert` / `Form.InsertMany` - Insert new records
 * - `Form.Update` / `Form.UpdateMany` - Update existing records
 * - `Form.Merge` / `Form.MergeMany` - Upsert records
 * - `Form.Field` - Register a field for state tracking (value, error, touched)
 * - `Form.Relation` - Nested child table with automatic FK wiring
 * - `Form.Each` - Iterate over records in a Many-type form table
 * - `Form.Temporary` - UI-only fields not backed by a database table
 * - `Form.Switch` / `Form.Match` - Conditional form sections
 * - `Form.ReadField` / `Form.ReadFields` - Read field values without creating editable bindings
 * - `Form.InlineEdit` - Inline editing for a single field
 * - `Form.SubmitButton` - Pre-wired submit button
 * - `Form.ErrorAlert` - Displays form-level write errors
 * - `Form.AutoFields` - Auto-generate Field entries for all table fields
 * - `Form.CheckboxField` / `Form.RadioGroupField` / `Form.RadioGroupEnumField` - Specialized field components
 *
 * @example
 * ```tsx
 * <Form afterSubmitClientSuccess={(s) => s.navigate(sql.lit`/todos`)}>
 *   <Form.Insert table="todos">
 *     <Form.Field field="title">
 *       {(helper) => <Input value={helper.value} onInput={(s) => helper.setValue(s, sql`target_value`)} />}
 *     </Form.Field>
 *     <Form.SubmitButton>Save</Form.SubmitButton>
 *   </Form.Insert>
 *   <Form.ErrorAlert />
 * </Form>
 * ```
 *
 * @category State Management Component
 */
export function Form(props: FormProps) {
  if (usePhase() === "gather") {
    // Isolate this Form's tables from any surrounding Form's gather context.
    // Without this, a nested Form's Form.Insert/Form.Update children would
    // register into the outer Form's gather context and get processed when
    // the outer form submits — producing blank rows in the inner tables.
    const gatherCtx = new FormGatherContext();
    gatherCtx.defaultFieldComponent = props.defaultFieldComponent;
    addCtx(gatherCtx);
    addCtx(new FormGatherStackCtx([]));
    return props.children;
  }
  const gatherCtx = new FormGatherContext();
  gatherCtx.defaultFieldComponent = props.defaultFieldComponent;
  addCtx(gatherCtx);
  addCtx(new FormGatherStackCtx([]));
  gatherChildrenContextInfo(props.children);
  const renderCtx = new FormContext();
  renderCtx.hasLastSavedStateHash = Boolean(props.beforeUnloadCheck);
  renderCtx.keepHistory = Boolean(props.keepHistory);
  renderCtx.historyThrottleTime = props.historyThrottle ?? 3_000;
  renderCtx.defaultFieldComponent = props.defaultFieldComponent;
  renderCtx.beforeSubmitClient = props.beforeSubmitClient;
  renderCtx.beforeTransactionStart = props.beforeTransactionStart;
  renderCtx.afterTransactionStart = props.afterTransactionStart;
  renderCtx.beforeTransactionCommit = props.beforeTransactionCommit;
  renderCtx.afterTransactionCommit = props.afterTransactionCommit;
  renderCtx.refetchOnSuccess = props.refetchOnSuccess ?? true;
  renderCtx.onSubmitServerError = props.onSubmitServerError;
  renderCtx.afterSubmitClientSuccess = (s, state) => {
    props.afterSubmitClientSuccess?.(s, state);
    if (props.afterSuccessNode) {
      s.setScalar("write_was_successful", true);
    }
  };
  renderCtx.onSubmitError = props.onSubmitError;
  const resolvedTables = new Map<string, FormTable>();
  for (const table of gatherCtx.tables) {
    renderCtx.tables[table.stateName] = resolveGatheredTable(
      resolvedTables,
      table,
    );
  }
  addCtx(renderCtx);
  addCtx(new WriteStackCtx([]));
  useState((s) => {
    s.defScalar("write_reset_key", 0);
  });
  useState({
    watch: props.watch
      ? Array.isArray(props.watch)
        ? [...props.watch, sql`write_reset_key`]
        : [props.watch, sql`write_reset_key`]
      : [sql`write_reset_key`],
    statusScalar: props.statusScalar,
    hasDataScalar: props.hasDataScalar,
    errorRecord: props.errorRecord,
    procedure: (s) => {
      s.defScalar("write_submitting", {
        type: "Bool",
        expr: false,
        allowNoRead: true,
      });
      s.defScalar(FORM_SUBMITTING_RECORD_TABLE_SCALAR, {
        type: "String",
        allowNoRead: true,
      });
      s.defScalar(FORM_SUBMITTING_RECORD_UI_ID_SCALAR, {
        type: "BigUint",
        allowNoRead: true,
      });
      s.defScalar("write_error", {
        type: "String",
        allowNoRead: true,
      });
      s.defScalar("next_write_id", {
        expr: 0,
        allowNoRead: true,
      });
      for (const table of Object.values(renderCtx.tables)) {
        if (table.parent) {
          continue;
        }
        defineFormTables(s, table, props.keepHistory ?? false);
      }
      for (const table of Object.values(renderCtx.tables)) {
        if (table.parent) {
          continue;
        }
        initializeFormTables(s, table);
      }
      if (props.keepHistory) {
        s.defScalar("write_history_in_delay", false);
        s.defScalar("write_current_history_index", 0);
        s.defScalar("undo_from_history_index", {
          type: "BigUint",
          allowNoRead: true,
        });
        s.defScalar("write_last_history_change_key", sql.lit``);
        s.defScalar("write_can_undo", {
          type: "Bool",
          expr: false,
          allowNoRead: true,
        });
        for (const table of Object.values(renderCtx.tables)) {
          createInitialHistoryEntry(s, table);
        }
      }
      if (props.afterSuccessNode) {
        s.defScalar("write_was_successful", false);
      }
      if (props.beforeUnloadCheck) {
        s.defScalar("last_saved_state_hash", renderCtx.stateHash());
      }
    },
  });
  const children = (
    <>
      {props.children}
      {props.submitOnDocumentEnterPlusCtrlOrCmd && (
        <EventHandlers
          document={{
            keydown: (s: DomStatements) => {
              s.if(
                sql`event.key = 'Enter' and (event.ctrl_key or event.meta_key)`,
                (s) => {
                  s.statements(renderCtx.submit);
                },
              );
            },
          }}
        />
      )}
      {props.submitOnDocumentEnter && (
        <EventHandlers
          document={{
            keydown: (s: DomStatements) => {
              s.if(sql`event.key = 'Enter' and not event.shift_key`, (s) => {
                s.statements(renderCtx.submit);
              });
            },
          }}
        />
      )}
      {props.beforeUnloadCheck && (
        <EventHandlers
          window={{
            beforeUnload: (s) => {
              s.if(
                sql`last_saved_state_hash != ${renderCtx.stateHash()}`,
                (s) => {
                  s.event.preventDefault();
                },
              );
            },
          }}
        />
      )}
    </>
  );
  if (props.afterSuccessNode) {
    return (
      <Show when={sql`write_was_successful`} fallback={children}>
        {props.afterSuccessNode}
      </Show>
    );
  }
  return children;
}

/**
 * Shared props for the `Form.Insert` / `Form.Update` / `Form.Merge` family
 * (and their `*Many` variants). Identifies the database table being written
 * and how its form state is seeded.
 */
export interface BaseWriteTableProps {
  /** Name of the database table to write. */
  table: string;
  /**
   * Override the auto-derived form state name (defaults to `write_<table>`,
   * or `write_<singular-table>` for single-row forms).
   */
  stateName?: string;
  children: Node;
  /** Fields to pre-register on the table without an explicit `Form.Field`. */
  fields?: (FormField | string)[];
  /** Query whose rows seed the form's initial records instead of an empty/loaded record. */
  initializeSource?: Sql;
  /** Per-field initial value overrides applied when seeding the form. */
  initializeValues?: Record<string, AnyExpr>;
  /** Enables validation of rows that have some, but not all, required input. */
  validatePartialRows?: PartialRowValidation;
}

function tableBase<T extends GatherFormTableType>(
  type: T,
  props: BaseWriteTableProps,
  updateTable: (
    formTable: Extract<GatherFormTable, { type: T }>,
    table: Table,
  ) => void,
  createTable: (
    formName: string,
    table: Table,
  ) => Extract<GatherFormTable, { type: T }>,
  isMany: boolean,
) {
  const table = system.db.tables[props.table];
  if (!table) {
    throw new Error(`Table ${props.table} not found`);
  }
  const formName = props.stateName ??
    (isMany ? `write_${table.name}` : `write_${singularize(table.name)}`);
  if (usePhase() === "gather") {
    const gatherCtx = useOptionalICtx(FormGatherICtxKey);
    if (!gatherCtx) {
      return;
    }
    let formTable = gatherCtx.getTable(formName);
    const didExist = Boolean(formTable);
    if (formTable) {
      if (formTable.type !== type && formTable.type !== "indirect") {
        throw new Error(
          `Table ${formName} already defined with different type or many`,
        );
      }
    } else {
      formTable = createTable(formName, table);
    }
    formTable.type = type;
    (formTable as DbBackedTable).table = table;
    (formTable as DbBackedTable).initializeSource = props.initializeSource;
    (formTable as DbBackedTable).initializeValues = props.initializeValues;
    if (props.validatePartialRows !== undefined) {
      (formTable as DbBackedTable).validatePartialRows =
        props.validatePartialRows;
    }
    updateTable(formTable as Extract<GatherFormTable, { type: T }>, table);
    for (const field of props.fields ?? []) {
      addInitialField(
        formTable,
        typeof field === "string" ? field : field.field,
        typeof field === "string" ? undefined : field.initialValue,
      );
    }
    if (!didExist) {
      gatherCtx.addTable(formTable);
    }
    extendFormGatherStackCtx({ type: "Table", table: formTable });
    return props.children;
  }
  const renderCtx = useICtx(FormICtxKey);
  const helper = renderCtx.table(formName);
  extendWriteStackCtx({ type: "Table", table: helper.table });
  return props.children;
}

export interface WriteInsertProps extends BaseWriteTableProps {
  /**
       Inserts the given values into the table.
       */
  values?: Record<string, AnyExpr>;
  /**
       If true, the table will not be initialized.
       By default the table will be initalized with an empty record.
       */
  dontInitialize?: boolean;
}

/** Insert a single new record into a database table. */
Form.Insert = function WriteInsert(props: WriteInsertProps) {
  return tableBase(
    "insert",
    props,
    (formTable, table) => {
      formTable.table = table;
      formTable.insertValues = props.values;
      formTable.filterOnParentFk = false;
      formTable.dontInitialize = Boolean(props.dontInitialize);
    },
    (formName, table) => ({
      type: "insert",
      fields: [],
      stateName: formName,
      relations: [],
      filterOnParentFk: false,
      table,
    }),
    false,
  );
};

(Form.Insert as any).getSource = (props: WriteInsertProps) => {
  return `Form.Insert table=${props.table}`;
};

export interface WriteInsertManyProps extends BaseWriteTableProps {
  /**
       Inserts the given values into the table.
       */
  values?: Record<string, AnyExpr>;
  /**
       If true, the table will not be initialized.
       By default the table will be initalized with an empty record.
       */
  dontInitialize?: boolean;
}

/** Insert multiple new records into a database table. */
Form.InsertMany = function WriteInsertMany(props: WriteInsertManyProps) {
  return tableBase(
    "insertMany",
    props,
    (formTable, table) => {
      formTable.table = table;
      formTable.insertValues = props.values;
      formTable.filterOnParentFk = false;
      formTable.dontInitialize = Boolean(props.dontInitialize);
    },
    (formName, table) => ({
      type: "insertMany",
      fields: [],
      stateName: formName,
      relations: [],
      filterOnParentFk: false,
      table,
    }),
    true,
  );
};

(Form.InsertMany as any).getSource = (props: WriteInsertManyProps) => {
  return `Form.InsertMany table=${props.table}`;
};

export interface WriteUpdateProps extends BaseWriteTableProps {
  where?: BooleanExpr;
  /**
       Sets the given fields to the given values when updating.
       */
  setFields?: Record<string, AnyExpr>;
  filterEmptyRecords?: boolean;
  filterBeforeSubmit?: BooleanExpr;
}

/** Update a single existing record. */
Form.Update = function WriteUpdate(props: WriteUpdateProps) {
  return tableBase(
    "update",
    props,
    (formTable, table) => {
      formTable.table = table;
      formTable.where = props.where;
      formTable.setFields = props.setFields;
      formTable.filterBeforeSubmit = props.filterBeforeSubmit;
    },
    (formName, table) => ({
      type: "update",
      fields: [],
      stateName: formName,
      relations: [],
      filterOnParentFk: false,
      table,
    }),
    false,
  );
};

(Form.Update as any).getSource = (props: WriteUpdateProps) => {
  return `Form.Update table=${props.table}`;
};

export interface WriteUpdateManyProps extends BaseWriteTableProps {
  where?: BooleanExpr;
  /**
       Sets the given fields to the given values when updating.
       */
  setFields?: Record<string, AnyExpr>;
  filterEmptyRecords?: boolean;
  filterBeforeSubmit?: BooleanExpr;
}

/** Update multiple existing records. */
Form.UpdateMany = function WriteUpdateMany(props: WriteUpdateManyProps) {
  return tableBase(
    "updateMany",
    props,
    (formTable, table) => {
      formTable.table = table;
      formTable.where = props.where;
      formTable.setFields = props.setFields;
      formTable.filterBeforeSubmit = props.filterBeforeSubmit;
    },
    (formName, table) => ({
      type: "updateMany",
      fields: [],
      stateName: formName,
      relations: [],
      filterOnParentFk: false,
      table,
    }),
    true,
  );
};

(Form.UpdateMany as any).getSource = (props: WriteUpdateManyProps) => {
  return `Form.UpdateMany table=${props.table}`;
};

export interface WriteMergeProps extends BaseWriteTableProps {
  where?: BooleanExpr;
  /**
       Merges the given values into the table.

       When querying it will ensure that each field equals the value in the table.
       When inserting it will insert the values into the table.
       */
  values?: Record<string, AnyExpr>;
  /**
       If true, an empty record will be created if this table is empty in the database
       */
  defaultEmptyRecord?: boolean;
  filterEmptyRecords?: boolean;
  filterBeforeSubmit?: BooleanExpr;
}

/** Insert or update (upsert) a single record. */
Form.Merge = function WriteMerge(props: WriteMergeProps) {
  return tableBase(
    "merge",
    props,
    (formTable, table) => {
      formTable.table = table;
      formTable.where = sql.and(
        props.where ?? true,
        ...Object.entries(props.values ?? {}).map(
          ([key, value]) => sql`${sql.ref(key)} = ${value}`,
        ),
      );
      formTable.insertValues = props.values;
      formTable.defaultEmptyRecord = Boolean(props.defaultEmptyRecord);
      formTable.filterEmptyRecords = Boolean(props.filterEmptyRecords);
      formTable.filterBeforeSubmit = props.filterBeforeSubmit;
    },
    (formName, table) => ({
      type: "merge",
      fields: [],
      stateName: formName,
      relations: [],
      filterOnParentFk: false,
      table,
    }),
    false,
  );
};

(Form.Merge as any).getSource = (props: WriteMergeProps) => {
  return `Form.Merge table=${props.table}`;
};

export interface WriteMergeManyProps extends BaseWriteTableProps {
  where?: BooleanExpr;
  values?: Record<string, AnyExpr>;
  defaultEmptyRecord?: boolean;
  filterEmptyRecords?: boolean;
  filterBeforeSubmit?: BooleanExpr;
  /**
   * Controls how persisted rows are deleted when they are absent from the
   * submitted form state.
   *
   * - `"missing"` deletes rows in the merge scope that are not submitted.
   *   This is the default for backwards compatibility.
   * - `"initial"` deletes only rows that were loaded when the form was
   *   initialized and are no longer submitted. Rows added concurrently by
   *   another session are preserved.
   */
  deleteBehavior?: MergeManyDeleteBehavior;
}

/** Insert or update (upsert) multiple records. */
Form.MergeMany = function WriteMergeMany(props: WriteMergeManyProps) {
  return tableBase(
    "mergeMany",
    props,
    (formTable, table) => {
      formTable.table = table;
      formTable.where = sql.and(
        props.where ?? true,
        ...Object.entries(props.values ?? {}).map(
          ([key, value]) => sql`${sql.ref(key)} = ${value}`,
        ),
      );
      formTable.insertValues = props.values;
      formTable.defaultEmptyRecord = Boolean(props.defaultEmptyRecord);
      formTable.filterEmptyRecords = Boolean(props.filterEmptyRecords);
      formTable.filterBeforeSubmit = props.filterBeforeSubmit;
      formTable.deleteBehavior = props.deleteBehavior;
    },
    (formName, table) => ({
      type: "mergeMany",
      fields: [],
      stateName: formName,
      relations: [],
      filterOnParentFk: false,
      table,
    }),
    true,
  );
};

(Form.MergeMany as any).getSource = (props: WriteMergeManyProps) => {
  return `Form.MergeMany table=${props.table}`;
};

export interface WriteTemporaryProps {
  name: string;
  many?: boolean;
  children: Node;
}

/** Define UI-only fields not backed by a database table. */
Form.Temporary = function WriteTemporary(props: WriteTemporaryProps) {
  if (usePhase() === "gather") {
    const gatherCtx = useOptionalICtx(FormGatherICtxKey);
    if (!gatherCtx) {
      return;
    }
    const formTable: GatherFormTable = {
      type: "temporary",
      stateName: props.name,
      fields: [],
      relations: [],
      filterOnParentFk: false,
    };
    gatherCtx.addTable(formTable);
    extendFormGatherStackCtx({ type: "Table", table: formTable });
    return props.children;
  }
  const renderCtx = useICtx(FormICtxKey);
  const helper = renderCtx.table(props.name);
  extendWriteStackCtx({ type: "Table", table: helper.table });
  return props.children;
};

/** Props for {@link Form.Field}, which registers a field for form state tracking. */
export interface WriteFieldProps {
  /** Name of the field (column) to track. */
  field: string;
  /** Initial value expression. Defaults to the field's database default, or a type-appropriate empty value when it has none. */
  initialValue?: AnyExpr;
  /** Explicit field type, required when the field is on a temporary table (no backing column). */
  fieldType?: HelperFieldType;
  /** Marks the field as required when it is not backed by a NOT NULL column. */
  required?: boolean;
  /**
   * Children can be:
   * - A Node (existing behavior - can use useFieldHelper() inside)
   * - A function that receives the field helper directly
   */
  children?: Node | ((helper: FormFieldHelper) => Node);
  /** Share this field's value across all rows of an `insertMany` table rather than per-row. */
  shared?: boolean;
}

/** Register a field for form state tracking (value, error, touched). */
Form.Field = function WriteField(props: WriteFieldProps) {
  if (usePhase() === "gather") {
    const currentTable = useGatherStackFrame("Table")?.table;
    if (!currentTable) {
      throw new Error("Form.Field must be used within a Form.Table");
    }
    const fieldModel = currentTable.type === "temporary"
      ? undefined
      : system.db.tables[currentTable.table!.name].fields[props.field];
    const field: FormField = {
      field: props.field,
      initialValue: props.initialValue ??
        (fieldModel ? defaultInitialValue(fieldModel) : sql.null),
      shared: Boolean(props.shared),
      required: Boolean(props.required),
    };
    if (currentTable.type === "temporary") {
      field.fieldType = props.fieldType;
    } else {
      if (!fieldModel) {
        throw new Error(
          `Field ${props.field} not found on table ${currentTable.table?.name}`,
        );
      }
      field.fieldModel = fieldModel;
    }
    if (props.shared) {
      if (currentTable.type !== "insertMany") {
        throw new Error(
          "Shared fields are only supported on insertMany tables for now",
        );
      }
    } else if (isManyTable(currentTable) && !useLastGatherEach()) {
      throw new Error(
        dedent`To have a form field on a table with many records, you must use Form.Each or mark the field as shared.
        Field: ${props.field}
        Table: ${currentTable.table?.name}`,
      );
    }
    if (
      !(
        field.fieldModel &&
        currentTable.fields.some((f) => f.field === props.field)
      )
    ) {
      currentTable.fields.push(field);
    }
    extendFormGatherStackCtx({ type: "Field", field });
    // Handle function children during gather phase
    if (typeof props.children === "function") {
      return props.children(GATHER_FIELD_STUB);
    }
    if (props.children) {
      return props.children;
    }
    const gatherContext = useICtx(FormGatherICtxKey);
    if (!gatherContext.defaultFieldComponent) {
      throw new Error(
        "Default field component not set and no child provided to form field",
      );
    }
    return <gatherContext.defaultFieldComponent />;
  }
  const stack = useICtx(FormStackICtxKey).stack;
  const currentTable = stack.findLast((f) => f.type === "Table")?.table;
  if (!currentTable) {
    throw new Error("Form.Field must be used within a Form.Table");
  }
  const field = currentTable.fields.find((f) => f.field === props.field);
  if (!field) {
    throw new Error(`Field ${props.field} not found`);
  }
  extendWriteStackCtx({ type: "Field", field });
  // Handle function children - pass the field helper directly
  if (typeof props.children === "function") {
    const helper = useFieldHelper();
    return props.children(helper);
  }
  if (props.children) {
    return props.children;
  }
  const renderCtx = useICtx(FormICtxKey);
  if (!renderCtx.defaultFieldComponent) {
    throw new Error(
      "Default field component not set and no child provided to form field",
    );
  }
  return <renderCtx.defaultFieldComponent />;
};

(Form.Field as any).getSource = (props: WriteFieldProps) => {
  return `Form.Field field=${props.field}`;
};

type FilterFrame<T, U extends FormStackFrame["type"]> = T extends { type: U }
  ? T
  : never;

function useStackFrame<T extends FormStackFrame["type"]>(
  frameType: T,
): FilterFrame<FormStackFrame, T> | undefined {
  const stack = useICtx(FormStackICtxKey).stack;
  return stack.findLast((frame) => frame.type === frameType) as any;
}

function useGatherStackFrame<T extends FormGatherStackFrame["type"]>(
  frameType: T,
): FilterFrame<FormGatherStackFrame, T> | undefined {
  const stack = useICtx(FormGatherStackICtxKey).stack;
  return stack.findLast((frame) => frame.type === frameType) as any;
}

function createFieldHelper(
  createHistory: boolean,
  historyThrottleTime: number,
  table: string,
  recordIdent: Sql,
  fieldName: string,
): FormFieldHelper {
  const viewFrame = useStackFrame("View");
  if (viewFrame?.recordId) {
    const fieldIdent = sql.ref(fieldName);
    const errorFieldIdent = sql.ref(`${fieldName}_write_error`);
    const touchedFieldIdent = sql.ref(`${fieldName}_write_touched`);
    return {
      error:
        sql`(select ${errorFieldIdent} from ${recordIdent} where write_ui_id = ${viewFrame.recordId})`,
      hasError:
        sql`exists (select 1 from ${recordIdent} where write_ui_id = ${viewFrame.recordId} and ${errorFieldIdent} is not null)`,
      value:
        sql`(select ${fieldIdent} from ${recordIdent} where write_ui_id = ${viewFrame.recordId})`,
      setValue: (s, value) => {
        s.modify(
          sql`update ${recordIdent} set ${fieldIdent} = ${value} where write_ui_id = ${viewFrame.recordId}`,
        );
        if (createHistory) {
          addHistory(s, {
            throttleTime: historyThrottleTime,
            key: sql.concat(table, fieldName, viewFrame.recordId),
            doCopy: (s) => {
              copyToHistoryTable(s, table);
            },
          });
        }
      },
      setError: (s, error) => {
        s.modify(
          sql`update ${recordIdent} set ${errorFieldIdent} = ${error} where write_ui_id = ${viewFrame.recordId}`,
        );
      },
      touched:
        sql`(select ${touchedFieldIdent} from ${recordIdent} where write_ui_id = ${viewFrame.recordId})`,
      setTouched: (s, touched) => {
        s.modify(
          sql`update ${recordIdent} set ${touchedFieldIdent} = ${touched} where write_ui_id = ${viewFrame.recordId}`,
        );
      },
    };
  }
  const fieldIdent = sql.ref(fieldName);
  const errorFieldIdent = sql.ref(`${fieldName}_write_error`);
  const touchedFieldIdent = sql.ref(`${fieldName}_write_touched`);
  return {
    error: sql`${recordIdent}.${errorFieldIdent}`,
    hasError: sql`${recordIdent}.${errorFieldIdent} is not null`,
    value: sql`${recordIdent}.${fieldIdent}`,
    setValue: (s, value) => {
      s.modify(sql`update ${recordIdent} set ${fieldIdent} = ${value}`);
      if (createHistory) {
        addHistory(s, {
          throttleTime: historyThrottleTime,
          key: sql.concat(table, fieldName),
          doCopy: (s) => {
            copyToHistoryTable(s, table);
          },
        });
      }
    },
    setError: (s, error) => {
      s.modify(sql`update ${recordIdent} set ${errorFieldIdent} = ${error}`);
    },
    touched: sql`${recordIdent}.${touchedFieldIdent}`,
    setTouched: (s, touched) => {
      s.modify(
        sql`update ${recordIdent} set ${touchedFieldIdent} = ${touched}`,
      );
    },
  };
}

interface AddHistoryOptions<T extends IStatementsBase> {
  throttleTime: NumericExpr;
  forceAdd?: boolean;
  key?: Sql;
  doCopy: (s: T) => void;
}

function addHistory<T extends IStatementsBase>(
  s: T,
  options: AddHistoryOptions<T>,
) {
  function addWithUpdatingHistoryIndex(s: T) {
    s.increment("write_current_history_index");
    s.setScalar("write_can_undo", true);
    s.setScalar("undo_from_history_index", sql.null);
    options.doCopy(s);
    if (options.key) {
      s.setScalar("write_last_history_change_key", options.key);
    }
  }
  if (s instanceof DomStatements && !options.forceAdd) {
    let condition = sql`write_history_in_delay`;
    if (options.key) {
      condition =
        sql`${condition} and ${options.key} = write_last_history_change_key`;
    }
    s.conditional({
      condition,
      then: (s) => {
        options.doCopy(s);
        if (options.key) {
          s.setScalar("write_last_history_change_key", options.key);
        }
      },
      else: (s) => {
        s.setScalar("write_history_in_delay", true);
        (s as unknown as DomStatements).startTaskWithOpts({
          detached: true,
          procedure: (s) => {
            s.sleep(options.throttleTime);
            s.setScalar("write_history_in_delay", false);
          },
        });
        addWithUpdatingHistoryIndex(s);
      },
    });
    return;
  }
  s.setScalar("write_history_in_delay", false);
  addWithUpdatingHistoryIndex(s);
}

/** Props for {@link Form.AutoFields}, which generates a `Form.Field` per table column. */
export interface WriteAutoFieldsProps {
  /** Field names to skip (in addition to the always-skipped Bytes/Json fields). */
  ignoreFields?: string[];
  /** Renders the editor node for each generated field. */
  renderField: (field: Field) => Node;
}

/** Automatically generate Form.Field entries for all table fields. */
Form.AutoFields = (props: WriteAutoFieldsProps) => {
  const currentTable = useGatherStackFrame("Table")?.table;
  if (!currentTable) {
    throw new Error("Form.AutoFields must be used within a Form.Table");
  }
  if (currentTable.type === "temporary") {
    throw new Error("You cannot use Form.AutoFields on a temporary table");
  }
  return Object.values(currentTable.table.fields)
    .filter((f) =>
      !props.ignoreFields?.includes(f.name) &&
      f.type !== "Bytes" &&
      f.type !== "Json"
    )
    .map((f) => <Form.Field field={f.name}>{props.renderField(f)}</Form.Field>);
};

function CheckboxFieldInner(
  props: ComponentOpts & {
    sx?: Style;
    label?: string | Sql;
    className?: string;
  },
) {
  if (usePhase() === "gather") {
    return;
  }
  const fieldHelper = useFieldHelper();
  const id = useUniqueId();
  return (
    <Checkbox
      id={id}
      checked={fieldHelper.value}
      onCheckboxChange={(s) => {
        fieldHelper.setValue(s, sql`target_checked`);
      }}
      sx={props.sx}
      size={props.size}
      variant={props.variant}
      color={props.color}
      label={props.label ?? useFieldModel().displayName}
      className={props.className}
    />
  );
}

/** Props for {@link Form.CheckboxField}. */
export interface CheckboxFieldProps extends WriteFieldProps, ComponentOpts {
  sx?: Style;
  className?: string;
  /** Label rendered next to the checkbox. */
  label?: string | Sql;
}

Form.CheckboxField = function CheckboxField(props: CheckboxFieldProps) {
  return (
    <Form.Field
      field={props.field}
      initialValue={props.initialValue}
      shared={props.shared}
    >
      <CheckboxFieldInner
        sx={props.sx}
        size={props.size}
        variant={props.variant}
        color={props.color}
        label={props.label}
        className={props.className}
      />
    </Form.Field>
  );
};

function TrueRadio(props: RadioProps) {
  if (usePhase() === "gather") {
    return;
  }
  const fieldHelper = useFieldHelper();
  return (
    <Radio
      {...props}
      label={props.label ?? "Yes"}
      checked={fieldHelper.value}
      onCheckboxChange={(s) => {
        fieldHelper.setValue(s, sql`target_checked`);
      }}
    />
  );
}

function FalseRadio(props: RadioProps) {
  if (usePhase() === "gather") {
    return;
  }
  const fieldHelper = useFieldHelper();
  return (
    <Radio
      {...props}
      label={props.label ?? "No"}
      checked={sql.not(fieldHelper.value)}
      onCheckboxChange={(s) => {
        fieldHelper.setValue(s, sql`not target_checked`);
      }}
    />
  );
}

/** Props for {@link Form.RadioGroupField} — binds a boolean field to a true/false radio pair. */
export interface BooleanRadioGroupProps extends WriteFieldProps {
  /** Radio shown for the `true` value (its label, color, etc.). */
  trueRadio: RadioProps;
  /** Radio shown for the `false` value. */
  falseRadio: RadioProps;
}

Form.RadioGroupField = (props: BooleanRadioGroupProps) => {
  return (
    <Form.Field
      field={props.field}
      initialValue={props.initialValue}
      shared={props.shared}
    >
      <RadioGroup>
        <TrueRadio {...props.trueRadio} />
        <FalseRadio {...props.falseRadio} />
      </RadioGroup>
    </Form.Field>
  );
};

/** Props for {@link Form.RadioGroupEnumField}, a radio group bound to an enum field. */
export interface RadioGroupEnumFieldProps extends WriteFieldProps {
  /** Label for an extra radio that sets the field to null; omit to disallow null. */
  nullVariant?: string;
}

function RadioGroupEnumFieldInner(props: RadioGroupEnumFieldProps) {
  if (usePhase() === "gather") {
    return null;
  }
  const fieldHelper = useFieldHelper();
  const fieldModel = useFieldModel();
  if (fieldModel.type !== "Enum") {
    throw new Error("Field is not an enum");
  }
  return (
    <RadioGroup>
      {props.nullVariant && (
        <Radio
          label={props.nullVariant}
          checked={sql.isNull(fieldHelper.value)}
          onClick={(s) => {
            fieldHelper.setValue(s, sql.null);
          }}
        />
      )}
      {Object.entries(system.enums[fieldModel.enum].values).map(
        ([value, info]) => (
          <Radio
            label={info.displayName}
            checked={sql`${fieldHelper.value} = ${sql.lit(value)}`}
            onClick={(s) => {
              fieldHelper.setValue(
                s,
                sql`cast(${sql.lit(value)} as enums.${
                  sql.ref(fieldModel.enum)
                })`,
              );
            }}
          />
        ),
      )}
    </RadioGroup>
  );
}

Form.RadioGroupEnumField = function RadioGroupEnumField(
  props: RadioGroupEnumFieldProps,
) {
  return (
    <Form.Field
      field={props.field}
      initialValue={props.initialValue}
      shared={props.shared}
    >
      <RadioGroupEnumFieldInner {...props} />
    </Form.Field>
  );
};

class WriteSwitchCtx implements ContextInstance, FormSwitchICtx {
  implementICtxs: ICtxKey<any>[] = [FormSwitchICtxKey];
  constructor(public hasOperand: boolean) {}
}

/** Props for {@link Form.Switch}, which conditionally renders form sections. */
export interface WriteSwitchProps {
  /** Field name to switch on; each `Form.Match` then compares against this field's value. */
  operand?: string;
  children: Node;
}

/** Conditional form sections based on a field value or expression. */
Form.Switch = function WriteSwitch(props: WriteSwitchProps) {
  if (props.operand) {
    addCtx(new WriteSwitchCtx(true));
    return (
      <Form.Field field={props.operand}>
        <Switch {...props}>{props.children}</Switch>
      </Form.Field>
    );
  }
  return <Switch {...props}>{props.children}</Switch>;
};

/** Props for {@link Form.Match}, a case within a {@link Form.Switch}. */
export interface WriteMatchProps {
  /**
   * Match condition. Under a `Form.Switch` with an `operand`, pass the value
   * to compare the operand field against; otherwise pass a field name whose
   * value is read as the boolean match expression.
   */
  when: AnyExpr | string;
  children: Node;
}

/** Match case within a Form.Switch. */
Form.Match = function WriteMatch(props: WriteMatchProps) {
  const hasOperand = useICtx(FormSwitchICtxKey).hasOperand;
  if (!hasOperand) {
    if (typeof props.when !== "string") {
      throw new Error(
        "You must provide a field name when using Form.Match under a switch with an operand",
      );
    }
    return (
      <Form.ReadField field={props.when}>
        {(field) => <Match when={field}>{props.children}</Match>}
      </Form.ReadField>
    );
  }
  if (typeof props.when === "string") {
    throw new Error(
      "You must provide an expression when using Read.Match under a switch with an operand",
    );
  }
  if (usePhase() === "gather") {
    return props.children;
  }
  const field = useFieldHelper();
  return (
    <Match when={sql`${field.value} = ${props.when}`}>{props.children}</Match>
  );
};

/** Props for {@link Form.ReadField}, which exposes a field's value without an editable binding. */
export interface WriteReadFieldProps {
  /** Name of the field to read. */
  field: string;
  /** Receives the field's current value expression. */
  children: (v: Sql) => Node;
}

function WriteReadFieldInner(props: WriteReadFieldProps) {
  if (usePhase() === "gather") {
    return props.children(sql.true);
  }
  const field = useFieldHelper();
  return props.children(field.value);
}

/** Read a field's value without creating an editable binding. */
Form.ReadField = function ReadField(props: WriteReadFieldProps) {
  return (
    <Form.Field field={props.field}>
      <WriteReadFieldInner {...props} />
    </Form.Field>
  );
};

export interface WriteReadFieldsProps<
  Fields extends readonly string[] = readonly string[],
> {
  fields: Fields;
  children: (values: { [K in Fields[number]]: Sql }) => Node;
}

interface WriteReadFieldsInnerProps<
  Fields extends readonly string[] = readonly string[],
> extends WriteReadFieldsProps<Fields> {
  index: number;
  values: Record<string, Sql>;
}

function WriteReadFieldsInner<
  Fields extends readonly string[] = readonly string[],
>(props: WriteReadFieldsInnerProps<Fields>) {
  const field = props.fields[props.index];
  if (!field) {
    return props.children(props.values as { [K in Fields[number]]: Sql });
  }
  return (
    <Form.ReadField field={field}>
      {(value) => (
        <WriteReadFieldsInner
          fields={props.fields}
          index={props.index + 1}
          values={{ ...props.values, [field]: value }}
        >
          {props.children}
        </WriteReadFieldsInner>
      )}
    </Form.ReadField>
  );
}

/** Read several form field values without creating nested render code. */
Form.ReadFields = function ReadFields<
  Fields extends readonly string[] = readonly string[],
>(props: WriteReadFieldsProps<Fields>) {
  return (
    <WriteReadFieldsInner
      fields={props.fields}
      index={0}
      values={{}}
    >
      {props.children}
    </WriteReadFieldsInner>
  );
};

/** Props for {@link Form.Relation}, a nested child table with automatic FK wiring. */
export interface WriteRelationProps {
  /** Name of the related database table. */
  table: string;
  /** Override the auto-derived form state name for the relation. */
  stateName?: string;
  /** Treat the relation as many rows; defaults based on FK direction. */
  many?: boolean;
  /**
       The field on the provided table that is the foreign key to the parent table

       If not specified, will be automatically found if there is a single foreign key
       to the parent table on the provided table.
       */
  field?: string;
  children: Node;
  /** Query whose rows seed the relation's initial records. */
  initializeSource?: Sql;
  /** Per-field initial value overrides applied when seeding the relation. */
  initializeValues?: Record<string, AnyExpr>;
  /** Skip seeding the relation with an initial record. */
  dontInitialize?: boolean;
  /** Fields to pre-register without an explicit `Form.Field`. */
  fields?: (FormField | string)[];
  /** Fixed values written to every related record on insert/merge. */
  values?: Record<string, AnyExpr>;
  /**
   * Controls deletion for many-row merge relations. See
   * {@link WriteMergeManyProps.deleteBehavior}.
   */
  deleteBehavior?: MergeManyDeleteBehavior;
  /** Enables validation of partially-filled related rows. */
  validatePartialRows?: PartialRowValidation;
  /** The relation may be absent; toggled via the `write_relation_exists` flag. */
  optional?: boolean;
  /** When `optional`, whether the relation starts out present. */
  optionalExistsByDefault?: boolean;
  /**
       If false, this relation may edit an existing related record but will not
       create a missing related record or delete one when the relation is unset.
       The parent foreign key should be managed by a regular Form.Field.
       */
  allowInsert?: boolean;
  onInsert?: <T extends IServerBaseStatements>(
    s: T,
    recordId: NumericExpr,
  ) => void;
}

function evaluateRelation(
  props: WriteRelationProps,
  currentTable: GatherFormTable,
): {
  fkField: Field;
  otherTable: Table;
  fkDirection: "childToParent" | "parentToChild";
} {
  if (currentTable.type === "temporary") {
    throw new Error("You cannot use Form.Relation on a temporary table");
  }
  const otherTable = system.db.tables[props.table];
  if (!otherTable) {
    throw new Error(`Table ${props.table} not found`);
  }
  if (!currentTable.table) {
    throw new Error("You cannot use Form.Relation on a temporary table");
  }

  // Try to find a foreign key from otherTable to currentTable (childToParent)
  function findFkFromOtherToCurrent(): Field | undefined {
    const fks = Object.values(otherTable.fields).filter(
      (f) =>
        f.type === "ForeignKey" &&
        f.table === (currentTable as DbBackedTable).table.name,
    );
    if (props.field) {
      return fks.find((f) => f.name === props.field);
    }
    if (fks.length === 1 && !props.field) {
      return fks[0];
    }
    return undefined;
  }

  // Try to find a foreign key from currentTable to otherTable (parentToChild)
  function findFkFromCurrentToOther(): Field | undefined {
    const fks = Object.values(
      (currentTable as DbBackedTable).table.fields,
    ).filter((f) => f.type === "ForeignKey" && f.table === otherTable.name);
    if (props.field) {
      return fks.find((f) => f.name === props.field);
    }
    if (fks.length === 1 && !props.field) {
      return fks[0];
    }
    return undefined;
  }

  let fkField: Field | undefined;
  let fkDirection: "childToParent" | "parentToChild";

  // First try other->current (this was original direction)
  fkField = findFkFromOtherToCurrent();
  if (fkField) {
    // childToParent means the otherTable references the currentTable
    fkDirection = "childToParent";
  } else {
    // If not found, try current->other (inverted direction)
    fkField = findFkFromCurrentToOther();
    if (fkField) {
      fkDirection = "parentToChild";
    } else {
      throw new Error(
        `Unable to determine relation field between ${
          currentTable.table!.name
        } and ${otherTable.name}.
        Please specify the field prop or ensure a single FK exists in one direction.`,
      );
    }
  }

  return { fkField, otherTable, fkDirection };
}

function addInitialField(
  formTable: GatherFormTable,
  fieldName: string,
  initialValue?: AnyExpr,
) {
  const fieldModel = (formTable as DbBackedTable).table?.fields[fieldName];
  if (!fieldModel) {
    throw new Error(
      `Field ${fieldName} not found on table ${formTable.stateName}`,
    );
  }
  if (formTable!.fields.find((f) => f.field === fieldName)) {
    return;
  }
  formTable!.fields.push({
    field: fieldName,
    initialValue: initialValue ?? defaultInitialValue(fieldModel),
    fieldModel,
  });
}

/** Define a nested child table relationship with automatic FK wiring. */
Form.Relation = function WriteRelation(props: WriteRelationProps) {
  if (usePhase() === "gather") {
    const gatherCtx = useICtx(FormGatherICtxKey);
    const currentTable = useICtx(FormGatherStackICtxKey).stack.findLast(
      (f) => f.type === "Table",
    )?.table;
    if (!currentTable) {
      throw new Error("Form.Relation must be used within a Form table");
    }
    const { fkField, otherTable, fkDirection } = evaluateRelation(
      props,
      currentTable,
    );
    if (fkDirection === "parentToChild" && props.many) {
      throw new Error(
        "Form.Relation cannot be used on a many table with a childToParent relation",
      );
    }
    if (fkDirection !== "parentToChild" && props.optional) {
      throw new Error("optional relations must be parentToChild");
    }
    let formTable = gatherCtx.getTable(props.stateName ?? otherTable.name);
    let type = currentTable.type === "insert" ||
        currentTable.type === "merge" ||
        currentTable.type === "mergeMany" ||
        currentTable.type === "insertMany"
      ? currentTable.type
      : "merge";
    if (props.many ?? fkDirection === "childToParent") {
      type = type === "merge" || type === "mergeMany"
        ? "mergeMany"
        : "insertMany";
    }
    if (props.deleteBehavior !== undefined && type !== "mergeMany") {
      throw new Error(
        "Form.Relation deleteBehavior can only be used on a many-row merge relation",
      );
    }
    if (formTable) {
      formTable.type = type;
    } else {
      formTable = {
        type,
        stateName: props.stateName ?? otherTable.name,
        table: otherTable,
        fields: [],
        filterOnParentFk: false,
        relations: [],
        optional: props.optional,
        optionalExistsByDefault: props.optionalExistsByDefault,
        validatePartialRows: props.validatePartialRows,
        allowInsert: props.allowInsert ?? true,
        onInsert: props.onInsert,
      };
    }
    formTable = formTable as DbBackedTable;
    if (props.validatePartialRows !== undefined) {
      formTable.validatePartialRows = props.validatePartialRows;
    }
    formTable.allowInsert = props.allowInsert ?? true;
    if (formTable.type === "mergeMany") {
      formTable.deleteBehavior = props.deleteBehavior;
    }
    if (props.initializeSource) {
      (formTable as FormTableInsert).initializeSource = props.initializeSource;
    }
    if (props.initializeValues) {
      (formTable as FormTableInsert).initializeValues = props.initializeValues;
    }
    formTable.filterOnParentFk =
      "filterOnParentFk" in currentTable && currentTable.filterOnParentFk
        ? currentTable.filterOnParentFk
        : isManyTable(currentTable);
    formTable.stateName = props.stateName ??
      ((props.many ?? true)
        ? `write_${otherTable.name}`
        : `write_${singularize(otherTable.name)}`);
    formTable.table = otherTable;
    formTable.parent = currentTable as FormTable;
    formTable.fkDirection = fkDirection;
    for (const f of props.fields ?? []) {
      const fieldName = typeof f === "string" ? f : f.field;
      addInitialField(
        formTable,
        fieldName,
        typeof f === "string" ? undefined : f.initialValue,
      );
    }
    for (const fieldName of Object.keys(props.initializeValues ?? {})) {
      addInitialField(formTable, fieldName, undefined);
    }
    formTable.parent = currentTable as FormTable;
    formTable.relationField = fkField;
    formTable.dontInitialize = Boolean(props.dontInitialize);
    if ("values" in formTable) {
      formTable.values = props.values;
    }
    currentTable.relations.push(formTable);
    extendFormGatherStackCtx({ type: "Table", table: formTable });
    return props.children;
  }
  const stack = useICtx(FormStackICtxKey).stack;
  const currentTable = stack.findLast((f) => f.type === "Table")?.table;
  if (!currentTable) {
    throw new Error("Form.Relation must be used within a Form table");
  }
  const { otherTable } = evaluateRelation(props, currentTable);
  const formName = props.stateName ??
    ((props.many ?? true)
      ? `write_${otherTable.name}`
      : `write_${singularize(otherTable.name)}`);
  const relation = currentTable.relations.find((r) => r.stateName === formName);
  if (!relation) {
    throw new Error(`Relation ${formName} not found`);
  }
  extendWriteStackCtx({ type: "Table", table: relation });
  return props.children;
};

// Extend the existing props to include ButtonProps
/**
 * Props for {@link Form.AddCurrentTableButton}, a button that appends a new
 * record to the current many-row form table. Inherits {@link ButtonProps}
 * minus `onClick`/`children`.
 */
export interface FormAddRelationButtonProps
  extends Omit<ButtonProps, "onClick" | "children"> {
  /** Initial field values for the new record. */
  fields?: Record<string, AnyExpr>;
  children?: Node;
}

Form.AddCurrentTableButton = (props: FormAddRelationButtonProps) => {
  if (usePhase() === "gather") {
    return props.children;
  }
  const addRecord = useAddRecordToCurrentTable();
  const { fields, children, ...buttonProps } = props;
  return (
    <Button
      {...buttonProps}
      onClick={(s) => {
        addRecord(s, fields ?? {});
      }}
    >
      {children}
    </Button>
  );
};

/** Returns a function to add a new record to the current Form table. */
export function useAddRecordToCurrentTable(): (
  s: DomStatements,
  fields: Record<string, AnyExpr>,
) => void {
  const helper = useCurrentTableHelper();
  const stack = useICtx(FormStackICtxKey).stack;
  const lastTableIndex = stack.findLastIndex((f) => f.type === "Table");
  const lastEachIndex = stack
    .slice(0, lastTableIndex)
    .findLastIndex((f) => f.type === "Each");
  const eachCtx = lastEachIndex >= 0 ? stack[lastEachIndex] : undefined;
  return (s, fields) => {
    helper.addRecord(
      s,
      fields ?? {},
      eachCtx
        ? sql`${sql.ref((eachCtx as any).recordName)}.write_ui_id`
        : undefined,
    );
  };
}

/** Props for {@link Form.Each}, which iterates over rows of a many-row form table. */
export interface WriteEachProps {
  /** SQL record name bound to each iteration. Defaults to the singularized form-state name. */
  recordName?: string;
  /** Node rendered when the table has no matching rows. */
  fallback?: Node;
  /** SQL `order by` expression controlling iteration order. */
  orderBy?: Sql;
  /** Children rendered for each row. */
  children?: Node;
  /** Render callback evaluated after the current row context is available. */
  render?: (cursor: CursorHelper) => Node;
}

/** Iterate over records in a Many-type form table. */
Form.Each = function WriteEach(props: WriteEachProps) {
  if (usePhase() === "gather") {
    const currentTable = useGatherStackFrame("Table")?.table;
    if (!currentTable) {
      throw new Error("Form.Each must be used within a Form table");
    }
    if (!isManyTable(currentTable)) {
      throw new Error("Form.Each can only be used on many tables");
    }
    extendFormGatherStackCtx({
      type: "Each",
      recordName: props.recordName ?? `${currentTable.stateName}_each_record`,
    });
    const children = props.render
      ? props.render(useCursorHelper())
      : props.children;
    return [props.fallback, children];
  }
  const currentTable = useStackFrame("Table")?.table;
  if (!currentTable) {
    throw new Error("Form.Each must be used within a Form table");
  }
  if (!isManyTable(currentTable)) {
    throw new Error("Form.Each can only be used on many tables");
  }
  const recordName = props.recordName ?? singularize(currentTable.stateName);
  let whereClause = sql.true;
  if (currentTable.filterOnParentFk) {
    const eachCtx = useStackFrame("Each");
    if (!eachCtx) {
      throw new Error("Invalid each state");
    }
    whereClause = sql`parent_write_ui_id = ${
      sql.ref(eachCtx.recordName)
    }.write_ui_id`;
  }
  extendWriteStackCtx({ type: "Each", recordName, where: whereClause });
  const children = props.render
    ? props.render(useCursorHelper())
    : props.children;
  const each = (
    <Each
      table={currentTable.stateName}
      recordName={recordName}
      where={whereClause}
      eachKey={sql`write_ui_id`}
      orderBy={props.orderBy}
    >
      {children}
    </Each>
  );
  if (props.fallback) {
    // may need to seperate this out so the fallback doesn't have the each context
    return (
      <Conditional
        when={sql`exists (select 1 from ${sql.ref(currentTable.stateName)} as ${
          sql.ref(recordName)
        } where ${whereClause})`}
        then={each}
        else={props.fallback}
      />
    );
  }
  return each;
};

/** Props for {@link Form.DeleteRecordButton} — a {@link Button} that deletes the current Form record. */
export interface FormDeleteRecordButtonProps
  extends Omit<ButtonProps, "onClick" | "children"> {
  children?: Node;
}

Form.DeleteRecordButton = (props: FormDeleteRecordButtonProps) => {
  if (usePhase() === "gather") {
    return props.children;
  }
  const helper = useCursorHelper();
  const { children, ...buttonProps } = props;

  return (
    <Button {...buttonProps} onClick={(s) => helper.delete(s)}>
      {children}
    </Button>
  );
};

Form.DeleteRecordIconButton = (props: Omit<IconButtonProps, "onClick">) => {
  if (usePhase() === "gather") {
    return props.children;
  }
  const helper = useCursorHelper();
  const { children, ...buttonProps } = props;
  return (
    <IconButton {...buttonProps} onClick={(s) => helper.delete(s)}>
      {children}
    </IconButton>
  );
};

/** Returns a CursorHelper for the current record in a Form.Each loop. Provides: `delete(s)`, `moveUp(s)`, `moveDown(s)`. */
export function useCursorHelper(): CursorHelper {
  // Return stub during gather phase - safe to use, does nothing
  if (usePhase() === "gather") {
    return GATHER_CURSOR_STUB;
  }
  const eachFrame = useStackFrame("Each");
  if (!eachFrame) {
    throw new Error("Missing each context in cursor helper");
  }
  const table = useStackFrame("Table")?.table;
  if (!table) {
    throw new Error("Missing table context in cursor helper");
  }
  const ctx = useICtx(FormICtxKey);
  return new CursorHelper(
    ctx.keepHistory,
    ctx.historyThrottleTime,
    table,
    eachFrame.recordName,
    eachFrame.where,
    ctx.submittingRecord(
      table.stateName,
      sql`${sql.ref(eachFrame.recordName)}.write_ui_id`,
    ),
  );
}

/** Returns a TableHelper for the current Form table. Provides: `addRecord(s, fields, afterId?)`. */
export function useCurrentTableHelper(): TableHelper {
  // Return stub during gather phase - safe to use, does nothing
  if (usePhase() === "gather") {
    return GATHER_TABLE_STUB;
  }
  const ctx = useICtx(FormICtxKey);
  const table = useStackFrame("Table");
  if (!table) {
    throw new Error("Form.CurrentTableHelper must be used within a Form.Table");
  }
  return new TableHelper(ctx.keepHistory, ctx.historyThrottleTime, table.table);
}

/**
 * Computes the initial form value expression for a field. Honors the field's
 * database `default`, then falls back to a sensible empty value per type
 * (empty string for text/number inputs, `null` or `false`/first enum value
 * for nullable/non-null booleans and enums). Numeric defaults are cast to
 * string since form state holds text.
 *
 * @category Helper
 */
export function defaultInitialValue(field: Field): AnyExpr {
  if (field.default !== undefined) {
    switch (field.type) {
      case "SmallInt":
      case "SmallUint":
      case "Int":
      case "Uint":
      case "BigInt":
      case "BigUint":
      case "Real":
      case "Double":
      case "Decimal":
        // this is because in the form, we expect a string, but in the database its a number
        return sql`cast(${field.default} as string)`;
      default:
        return field.default;
    }
  }
  switch (field.type) {
    case "Bool":
      return field.notNull ? sql.false : sql.null;
    case "String":
    case "TinyUint":
    case "TinyInt":
    case "Decimal":
    case "SmallInt":
    case "SmallUint":
    case "Int":
    case "Uint":
    case "Uuid":
    case "BigInt":
    case "Real":
    case "Double":
    case "BigUint":
    case "PhoneNumber":
      return sql.lit``;
    case "Enum": {
      if (field.notNull) {
        const enum_ = system.enums[field.enum];
        if (!enum_) {
          throw new Error(`Enum ${field.enum} not found`);
        }
        const firstValue = Object.values(enum_.values)[0];
        return sql`cast(${sql.lit(firstValue.name)} as enums.${
          sql.ref(enum_.name)
        })`;
      }
      return sql.null;
    }
    case "Date":
    case "TimestampNaive":
    case "TimestampUtc":
    case "TimestampTz":
    case "ForeignKey":
    case "Tx":
    case "Time":
    case "Ordering":
      return sql.null;
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        return sql.lit``;
      }
      return sql.null;
    }
    case "Json":
      return sql.null;
  }
}

function isDefaultOrEmpty(
  field: Field,
  valueExpr: AnyExpr,
  overrideInitialValue?: AnyExpr,
): BooleanExpr {
  let base: BooleanExpr;
  switch (field.type) {
    case "Bool": {
      if (field.notNull) {
        base = sql`${valueExpr} is null or not ${valueExpr}`;
      } else {
        base = sql`${valueExpr} is null`;
      }
      break;
    }
    case "TinyUint":
    case "TinyInt":
    case "Decimal":
    case "SmallInt":
    case "SmallUint":
    case "Int":
    case "Uint":
    case "Uuid":
    case "BigInt":
    case "Real":
    case "Double":
    case "BigUint":
    case "PhoneNumber":
    case "String": {
      base = sql`${valueExpr} is null or trim(${valueExpr}) = ''`;
      break;
    }
    case "Enum": {
      if (field.notNull) {
        const enum_ = system.enums[field.enum];
        const firstValue = Object.values(enum_.values)[0];
        base = sql`${valueExpr} = cast(${sql.lit(firstValue.name)} as enums.${
          sql.ref(enum_.name)
        })`;
      } else {
        base = sql`${valueExpr} is null`;
      }
      break;
    }
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        base = sql`${valueExpr} is null`;
      } else {
        throw new Error(`${field.type} not implemented for forms`);
      }
      break;
    }
    case "Date":
    case "TimestampNaive":
    case "TimestampUtc":
    case "TimestampTz":
    case "Time":
    case "Tx":
    case "ForeignKey":
      base = sql`${valueExpr} is null`;
      break;
    case "Ordering":
    case "Json":
      throw new Error(`${field.type} not implemented for forms`);
  }
  if (
    sql.isAnyExpr(overrideInitialValue) && overrideInitialValue !== sql.null
  ) {
    return sql`${valueExpr} = ${overrideInitialValue} or ${base}`;
  }
  return base;
}

/**
 * The default client-side field validator used by {@link Form}. Runs the
 * field's configured `checks` first, then type-specific validation (required,
 * min/max length, numeric range, email/phone/uuid parsing, etc.), setting the
 * field error via the {@link FormFieldHelper} on the first failure.
 *
 * @category Helper
 */
export function defaultValidate(
  field: Field,
  { error, value, setError }: FormFieldHelper,
  s: DomStatements,
) {
  function checkForError(
    expr: BooleanExpr,
    error: Sql | string,
    statements = s,
  ) {
    statements.if(
      expr,
      (s) => setError(s, typeof error === "string" ? sql.lit(error) : error),
    );
  }
  if (field.checks) {
    for (const check of field.checks) {
      checkForError(
        sql`${error} is null and not (${check.check(value)})`,
        check.errorMessage(value),
      );
    }
  }
  switch (field.type) {
    case "String": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      if (field.minLength) {
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and char_length(${value}) < ${field.minLength}`,
          sql.lit`Expected at least ${field.minLength} charcters`,
        );
      }
      if (field.usage) {
        if (field.usage.type === "Email") {
          checkForError(
            sql`${error} is null and ${value} is not null and trim(${value}) != '' and not string.is_valid_email(${value})`,
            sql.lit`Invalid email address`,
          );
        }
      }
      checkForError(
        sql`${error} is null and ${value} is not null and char_length(${value}) > ${field.maxLength}`,
        sql.lit`Expected at most ${field.maxLength} characters`,
      );
      break;
    }
    case "PhoneNumber": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      checkForError(
        sql`${error} is null and ${value} is not null and trim(${value}) != '' and phone.try_parse(${value}) is null`,
        sql.lit`Invalid phone number`,
      );
      break;
    }
    case "ForeignKey": {
      if (field.notNull) {
        checkForError(sql`${value} is null`, sql.lit`Required`);
      }
      break;
    }
    case "Bool":
      break;
    case "TinyInt":
    case "TinyUint":
    case "SmallInt":
    case "SmallUint":
    case "Int":
    case "Uint":
    case "BigInt":
    case "BigUint": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      if (field.usage) {
        if (field.usage.type === "Duration") {
          return;
        }
      }
      let min = field.min;
      let max = field.max;
      if (!min) {
        switch (field.type) {
          case "TinyUint":
          case "SmallUint":
          case "Uint":
          case "BigUint": {
            min = sql`0`;
            break;
          }
          case "TinyInt": {
            min = sql`-128`;
            break;
          }
          case "SmallInt": {
            min = sql`-32768`;
            break;
          }
          case "Int": {
            min = sql`-2147483648`;
            break;
          }
          case "BigInt": {
            min = sql`-9223372036854775808`;
            break;
          }
        }
      }
      if (!max) {
        switch (field.type) {
          case "TinyUint": {
            max = sql`255`;
            break;
          }
          case "SmallUint": {
            max = sql`65535`;
            break;
          }
          case "Uint": {
            max = sql`4294967295`;
            break;
          }
          case "TinyInt": {
            max = sql`127`;
            break;
          }
          case "SmallInt": {
            max = sql`32767`;
            break;
          }
          case "Int": {
            max = sql`2147483647`;
            break;
          }
          case "BigUint":
          case "BigInt": {
            max = sql`9223372036854775807`;
            break;
          }
        }
      }
      s.block((s) => {
        // I will have to deal with more locales here in the future
        s.defScalar(
          "as_bigint",
          sql`try_cast(regex.replace_all(${value}, '[^0-9.-]', '') as bigint)`,
        );
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and as_bigint is null`,
          sql.lit`Not a valid number`,
          s,
        );
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and as_bigint is not null and as_bigint < ${min!}`,
          sql.concat("Must be at least ", min),
          s,
        );
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and as_bigint is not null and as_bigint > ${max!}`,
          sql.concat("Must be at most ", max),
          s,
        );
      });
      break;
    }
    case "Real": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      s.block((s) => {
        s.defScalar(
          "as_real",
          sql`try_cast(regex.replace_all(${value}, '[^0-9.-]', '') as real)`,
        );
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and try_cast(${value} as real) is null`,
          sql.lit`Not a valid number`,
          s,
        );
      });
      break;
    }
    case "Double": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      s.block((s) => {
        s.defScalar(
          "as_double",
          sql`try_cast(regex.replace_all(${value}, '[^0-9.-]', '') as double)`,
        );
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and try_cast(${value} as double) is null`,
          sql.lit`Not a valid number`,
        );
      });
      break;
    }
    case "Decimal": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      // eventually I should improve the error message here
      s.block((s) => {
        s.defScalar(
          "as_decimal",
          sql`try_cast(regex.replace_all(${value}, '[^0-9.-]', '') as decimal(${field.precision}, ${field.scale}))`,
        );
        checkForError(
          sql`${error} is null and ${value} is not null and trim(${value}) != '' and as_decimal is null`,
          sql.lit`Not a valid decimal`,
          s,
        );
      });
      break;
    }
    case "Uuid": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      checkForError(
        sql`${error} is null and ${value} is not null and trim(${value}) != '' and try_cast(${value} as uuid) is null`,
        sql.lit`Invalid UUID`,
      );
      break;
    }
    case "Tx": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      checkForError(
        sql`${error} is null and ${value} is not null and trim(${value}) != '' and try_cast(${value} as bigint) is null`,
        sql.lit`Tx id must be a number`,
      );
      break;
    }
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        if (field.notNull) {
          checkForError(
            sql`${value} is null or trim(${value}) = ''`,
            sql.lit`Required`,
          );
        }
      }
      break;
    }
    case "TimestampNaive":
    case "TimestampUtc":
    case "TimestampTz":
    case "Time":
    case "Date": {
      if (field.notNull) {
        checkForError(
          sql`${value} is null or trim(${value}) = ''`,
          sql.lit`Required`,
        );
      }
      break;
    }
  }
  return s;
}

/**
 * Converts a field's form-state (text) value into the value written to the
 * database column: trims/empties strings to null, parses numeric/uuid/phone
 * text, encrypts secret bytes, etc. Inverse of {@link getFormValueFromDbValue}.
 *
 * @category Helper
 */
export function getDbValueFromFormValue(
  field: Field,
  valueExpr: AnyExpr,
): AnyExpr {
  if ("usage" in field) {
    if (field.usage?.type === "Duration") {
      if (field.usage?.size !== "minutes") {
        throw new Error("Only minutes duration is supported");
      }
      return sql`fn.parse_minutes_duration(${valueExpr})`;
    }
  }
  switch (field.type) {
    case "String":
      return sql`case when trim(${valueExpr}) != '' then trim(${valueExpr}) end`;
    case "TinyInt":
    case "TinyUint":
    case "SmallInt":
      return sql`try_cast(regex.replace_all(${valueExpr}, '[^0-9.-]', '') as smallint)`;
    case "SmallUint":
    case "Int":
      return sql`try_cast(regex.replace_all(${valueExpr}, '[^0-9.-]', '') as int)`;
    case "Uint":
    case "BigInt":
    case "BigUint":
      return sql`try_cast(regex.replace_all(${valueExpr}, '[^0-9.-]', '') as bigint)`;
    case "Decimal":
      return sql`try_cast(regex.replace_all(${valueExpr}, '[^0-9.-]', '') as decimal(${field.precision}, ${field.scale}))`;
    case "Tx":
      return sql`try_cast(${valueExpr} as bigint)`;
    case "Uuid":
      return sql`case when ${valueExpr} != '' then cast(${valueExpr} as uuid) end`;
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        return sql`case when ${valueExpr} != '' then crypto.encrypt(${valueExpr}, ${
          sql.lit(field.usage.encryptionKey)
        }) end`;
      }
      return valueExpr;
    }
    case "PhoneNumber":
      return sql`case when ${valueExpr} != '' then phone.parse(${valueExpr}) end`;

    default:
      return valueExpr;
  }
}

/**
 * Converts a database column value into the field's form-state value when
 * seeding a form (e.g. formats a minutes-duration for display). Inverse of
 * {@link getDbValueFromFormValue}; most types pass through unchanged.
 *
 * @category Helper
 */
export function getFormValueFromDbValue(
  field: Field,
  valueExpr: AnyExpr,
): AnyExpr {
  if ("usage" in field) {
    if (field.usage?.type === "Duration") {
      if (field.usage?.size !== "minutes") {
        throw new Error("Only minutes duration is supported");
      }
      return sql`fn.display_minutes_duration(${valueExpr})`;
    }
  }
  return valueExpr;
}

/**
 * Maps a database {@link Field} to the {@link FieldType} used for its form
 * state scalar. Text-like and numeric fields become wide `String` columns so
 * the UI can hold raw input and surface its own validation errors rather than
 * failing on cast/length at the database layer.
 *
 * @category Helper
 */
export function formFieldType(field: Field): FieldType {
  switch (field.type) {
    // in the ui procs, we don't want to error on going over max length so we can provide better error messages
    case "String":
    case "TinyUint":
    case "TinyInt":
    case "Decimal":
    case "SmallInt":
    case "SmallUint":
    case "Int":
    case "Uint":
    case "Uuid":
    case "BigInt":
    case "Real":
    case "Double":
    case "BigUint":
    case "Tx":
    case "PhoneNumber":
      return { type: "String", maxLength: 2_000_000 };
    case "ForeignKey":
      return { type: "BigUint" };
    case "Enum":
      return { type: "Enum", enum: field.enum };
    case "Bool":
    case "Date":
    case "TimestampNaive":
    case "Time":
    case "TimestampTz":
    case "Ordering":
    case "Json":
      return { type: field.type };
    case "TimestampUtc":
      return { type: "TimestampTz" };
    case "Bytes": {
      if (field.usage?.type === "Secret") {
        return { type: "String", maxLength: 2_000_000 };
      }
      return { type: field.type, maxLength: 2_000_000 };
    }
  }
}

/** Props for {@link Form.SubmitButton}. Inherits {@link ButtonProps} minus `onClick`/`loading`. */
export interface FormSubmitButtonProps
  extends
    Omit<ButtonProps, "onClick" | "children" | "loading">,
    Omit<HTMLAttributes, "color"> {
  children?: Node;
}

/** Pre-wired submit button that triggers form submission. */
Form.SubmitButton = function SubmitButton(props: FormSubmitButtonProps) {
  if (usePhase() !== "render") {
    return [];
  }
  const ctx = useICtx(FormICtxKey);
  return (
    <Button
      {...props}
      onClick={(s) => {
        ctx.submit(s);
      }}
      loading={ctx.submitting}
    >
      {props.children}
    </Button>
  );
};

/**
 * Helper object returned by {@link useFieldHelper}. Bundles the SQL value,
 * touched, and error state for a single form field along with setters for
 * each. Field components use this to wire up two-way bindings.
 */
export interface FormFieldHelper {
  /** SQL expression for the current value. */
  value: Sql;
  /** Statements that set the field's value. */
  setValue: <T extends IStatementsBase>(s: T, value: AnyExpr) => unknown;
  /** SQL expression for the current error message (nullable). */
  error: Sql;
  /** SQL boolean expression — true when the field has an error. */
  hasError: BooleanExpr;
  /** Statements that set the field's error. */
  setError: <T extends IStatementsBase>(s: T, error: Sql) => unknown;
  /** SQL boolean expression — true once the field has been visited. */
  touched: BooleanExpr;
  /** Statements that set the field's touched state. */
  setTouched: <T extends IStatementsBase>(
    s: T,
    touched: BooleanExpr,
  ) => unknown;
}

// ============================================
// STUB HELPERS FOR GATHER PHASE
// These allow hooks to be called during gather phase without guards.
// They return safe no-op implementations.
// ============================================

const GATHER_FIELD_STUB: FormFieldHelper = Object.freeze({
  value: sql`null`,
  error: sql`null`,
  hasError: sql`false`,
  touched: sql`false`,
  setValue: () => {},
  setError: () => {},
  setTouched: () => {},
});

class GatherTableHelperStub {
  readonly keepHistory = false;
  readonly historyThrottleTime = 0;
  readonly table = undefined as any;

  get tableIdent() {
    return sql`null`;
  }

  get hasAnyError() {
    return sql`false`;
  }

  copyRecursiveToHistoryTable<T extends IStatementsBase>(_s: T) {}

  addRecord<T extends IStatementsBase>(
    _s: T,
    _fields?: Record<string, AnyExpr>,
    _parentUiId?: AnyExpr,
  ) {}

  addRecordWithRelations<T extends IStatementsBase>(
    _s: T,
    _fields?: Record<string, AnyExpr>,
    _relations?: Record<string, Record<string, AnyExpr>[]>,
    _parentUiId?: AnyExpr,
  ) {}

  deleteAllRecords<T extends IStatementsBase>(_s: T) {}
}

const GATHER_TABLE_STUB: TableHelper = Object.freeze(
  new GatherTableHelperStub(),
) as unknown as TableHelper;

class GatherCursorHelperStub {
  readonly keepHistory = false;
  readonly historyThrottleTime = 0;
  readonly table = undefined as any;
  readonly recordName = "";

  get iterationIndex() {
    return sql`0`;
  }

  get isLast() {
    return sql`false`;
  }

  get isSubmitting() {
    return sql`false`;
  }

  get recordIdent() {
    return sql`null`;
  }

  get recordUiId() {
    return sql`null`;
  }

  get recordDbId() {
    return sql`null`;
  }

  addRecord<T extends IStatementsBase>(
    _s: T,
    _values: Record<string, AnyExpr>,
  ) {}

  delete<T extends IStatementsBase>(_s: T) {}

  duplicate<T extends IStatementsBase>(_s: T) {}

  field(_name: string): FormFieldHelper {
    return GATHER_FIELD_STUB;
  }

  setEmpty<T extends IStatementsBase>(_s: T) {}

  isNotEmpty() {
    return sql`false`;
  }

  isEmpty() {
    return sql`true`;
  }
}

const GATHER_CURSOR_STUB: CursorHelper = Object.freeze(
  new GatherCursorHelperStub(),
) as unknown as CursorHelper;

function useLastEach() {
  const stack = useICtx(FormStackICtxKey).stack;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame.type === "Table") {
      return;
    }
    if (frame.type === "Each") {
      return frame;
    }
  }
}

function useLastGatherEach() {
  const stack = useICtx(FormGatherStackICtxKey).stack;
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame.type === "Table") {
      return;
    }
    if (frame.type === "View") {
      return frame;
    }
    if (frame.type === "Each") {
      return frame;
    }
  }
}

/** Returns a FormFieldHelper for the current Form.Field. Provides: `value` (SQL), `error` (SQL), `hasError` (SQL), `touched` (SQL), `setValue(s, expr)`, `setError(s, expr)`, `setTouched(s, expr)`. */
export function useFieldHelper(): FormFieldHelper {
  // Return stub during gather phase - safe to use, does nothing
  if (usePhase() === "gather") {
    return GATHER_FIELD_STUB;
  }
  const cursor = useLastEach();
  const currentTable = useStackFrame("Table")?.table;
  if (!currentTable) {
    throw new Error("Missing table context in field helper");
  }
  let recordIdent = cursor
    ? sql.ref(cursor.recordName)
    : sql.ref(currentTable.stateName);
  const field = useStackFrame("Field")?.field;
  if (!field) {
    throw new Error("Missing field context in field helper");
  }
  if (field.shared) {
    recordIdent = sql.ref(`${currentTable.stateName}_shared_fields`);
  }
  const ctx = useICtx(FormICtxKey);
  return createFieldHelper(
    ctx.keepHistory,
    ctx.historyThrottleTime,
    currentTable.stateName,
    recordIdent,
    field.field,
  );
}

/** Returns the current FormField metadata. */
export function useCurrentField(): FormField {
  const field = useStackFrame("Field")?.field;
  if (!field) {
    throw new Error("Missing field context in field helper");
  }
  return field;
}

/** Returns the Field model (schema definition) for the current Form.Field. */
export function useFieldModel(): Field {
  const field = useStackFrame("Field")?.field;
  if (!field) {
    throw new Error("Missing field context in field helper");
  }
  if (!field.fieldModel) {
    throw new Error("Field model not found");
  }
  return field.fieldModel;
}

/** Returns the current FormTable in scope. */
export function useCurrentTable(): FormTable {
  const table = useStackFrame("Table")?.table;
  if (!table) {
    throw new Error("Missing table context in field helper");
  }
  return table;
}

/**
 * During the gather phase, sets the current `Form.Field`'s type when it is not
 * backed by a database column (e.g. fields on a temporary table). No-op outside
 * gather or when the field already has a model. Used by custom field components.
 *
 * @category Helper
 */
export function setFieldTypeIfNotFromModel(ty: HelperFieldType) {
  if (usePhase() !== "gather") {
    return;
  }
  const field = useGatherStackFrame("Field")?.field;
  if (!field) {
    throw new Error("Missing field context in field helper");
  }
  if (field.fieldModel) {
    return;
  }
  field.fieldType = ty;
}

export interface FormErrorAlertProps
  extends Omit<AlertProps, "color" | "startIcon" | "children"> {
  /** Which form error category to display. Defaults to write/server errors only. */
  mode?: "all" | "write" | "validation";
  /** Message shown when validation failed but no write/server error exists. */
  validationMessage?: Sql | string;
}

/** Displays form-level write errors, submit-blocking validation errors, or both. */
Form.ErrorAlert = (props: FormErrorAlertProps) => {
  if (usePhase() !== "render") {
    return [];
  }
  const {
    mode = "write",
    validationMessage = "Errors in the form",
    ...alertProps
  } = props;
  const ctx = useICtx(FormICtxKey);
  const validationMessageExpr = typeof validationMessage === "string"
    ? sql.lit(validationMessage)
    : validationMessage;
  const when = mode === "write"
    ? ctx.hasWriteError
    : mode === "validation"
    ? sql.and(ctx.hasAnyError, sql.not(ctx.hasWriteError))
    : ctx.hasAnyError;
  const message = mode === "write"
    ? ctx.writeError
    : mode === "validation"
    ? validationMessageExpr
    : sql.coalesce(ctx.writeError, validationMessageExpr);
  return (
    <Show when={when}>
      <Alert color="danger" startIcon="Error" {...alertProps}>
        {message}
      </Alert>
    </Show>
  );
};

/** Props for {@link Form.View}. */
export interface FormViewProps {
  /** Id of the existing record this view edits. */
  recordId: NumericExpr;
  children?: Node;
}

Form.View = (props: FormViewProps) => {
  if (usePhase() === "gather") {
    const currentTable = useGatherStackFrame("Table")?.table;
    if (!currentTable) {
      throw new Error("Form.View must be used within a Form table");
    }
    extendFormGatherStackCtx({
      type: "View",
      recordId: props.recordId,
    });
    return props.children;
  }
  const currentTable = useStackFrame("Table")?.table;
  if (!currentTable) {
    throw new Error("Form.View must be used within a Form table");
  }
  extendWriteStackCtx({
    type: "View",
    recordId: props.recordId,
  });
  if (props.children) {
    return props.children;
  }
};

/** Props for {@link Form.IndirectView}. */
export interface FormIndirectViewProps {
  /** Id of the existing record this view edits. */
  recordId: NumericExpr;
  /** Name of the table the record belongs to, when it differs from the enclosing Form table. */
  table: string;
  children?: Node;
}

/**
 This is used to reference a table that was defined in a different part of the tree.

 Form.View references the table defined higher up in the tree. This allows you to refer
 to a table that is defined in a different part of the tree without defining it.
 */
Form.IndirectView = function IndirectView(props: FormIndirectViewProps) {
  if (usePhase() === "gather") {
    const gatherCtx = useOptionalICtx(FormGatherICtxKey);
    if (!gatherCtx) {
      return;
    }
    const existingTable = gatherCtx.getTable(props.table);
    const table = system.db.tables[props.table];
    if (!table) {
      throw new Error(`Table ${props.table} not found`);
    }
    if (existingTable) {
      extendFormGatherStackCtx({ type: "Table", table: existingTable });
    } else {
      const formTable: GatherFormTable = {
        type: "indirect",
        stateName: props.table,
        table,
        fields: [],
        relations: [],
      };
      gatherCtx.addTable(formTable);
      extendFormGatherStackCtx({ type: "Table", table: formTable });
    }
    extendFormGatherStackCtx({
      type: "View",
      recordId: props.recordId,
    });
    return props.children;
  }
  const renderCtx = useICtx(FormICtxKey);
  const helper = renderCtx.table(props.table);
  extendWriteStackCtx({ type: "Table", table: helper.table });
  extendWriteStackCtx({
    type: "View",
    recordId: props.recordId,
  });
  return props.children;
};

/** Props for {@link Form.InlineEdit}, click-to-edit for one field on a record page. */
export interface FormInlineEditProps extends
  Pick<
    WriteProcExtensions,
    "afterTransactionStart" | "beforeTransactionCommit"
  > {
  /** Name of the field to edit. Resolved against the current record's table. */
  field: string;
  sx?: Style;
  /** Style applied to the inline input. */
  inputSx?: Style;
  /** Node shown when the field has no value. */
  placeholder?: Node;
  editTrigger?: "display" | "icon";
}

/** Inline editing for a single field on a record page. */
Form.InlineEdit = function InlineEdit(props: FormInlineEditProps) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const field = currentTable.fields[props.field];
  if (!field) {
    throw new Error(
      `Field ${props.field} not found on table ${currentTable.name}`,
    );
  }
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  useState((s) => {
    s.defScalar("editing", false);
    s.defScalar("refetch_key", 0);
  });
  useState({
    procedure: (s) => {
      s.defScalar(
        "value",
        sql`(select ${
          sql.ref(field.name)
        } from ${currentTable.identWithDb} where id = ${currentRecordId})`,
      );
    },
    watch: [sql`refetch_key`],
  });

  function InlineSaveComponent() {
    const ctx = useICtx(FormICtxKey);
    return (
      <>
        <IconButton
          variant="plain"
          color="primary"
          size="sm"
          aria-label="Save"
          onClick={(s) => {
            ctx.submit(s);
          }}
        >
          <MaterialIcon icon="Save" />
        </IconButton>
        <IconButton
          variant="plain"
          color="danger"
          size="sm"
          aria-label="Cancel"
          onClick={(s) => {
            s.setScalar("editing", false);
          }}
        >
          <MaterialIcon icon="Cancel" />
        </IconButton>
      </>
    );
  }

  function InlineEditField() {
    if (usePhase() === "gather") {
      return;
    }
    const helper = useFieldHelper();
    return (
      <FormControl>
        <FieldFormControl
          field={field}
          endDecorator={<InlineSaveComponent />}
          immediateFocus
        />
        <Show when={helper.hasError}>
          <div
            sx={{
              display: "flex",
              alignItems: "center",
              fontSize: "sm",
              lineHeight: "sm",
              color: "danger-500",
              mt: 0.75,
            }}
          >
            {helper.error}
          </div>
        </Show>
      </FormControl>
    );
  }

  return (
    <Conditional
      when={sql`editing`}
      then={
        <Form
          submitOnDocumentEnter
          defaultFieldComponent={InlineEditField}
          afterTransactionStart={props.afterTransactionStart}
          beforeTransactionCommit={props.beforeTransactionCommit}
          afterSubmitClientSuccess={(s) => {
            s.setScalar("editing", false);
            s.increment("refetch_key");
            triggerRefetch(s);
          }}
        >
          <Form.Update
            table={currentTable.name}
            where={sql`id = ${currentRecordId}`}
          >
            <Form.Field field={field.name} />
          </Form.Update>
        </Form>
      }
      else={
        <div
          sx={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 1,
            ...props.sx,
          }}
          onClick={props.editTrigger === "icon" ? undefined : (s) => {
            s.setScalar("editing", true);
          }}
          tabIndex={props.editTrigger === "icon" ? undefined : 0}
          onKeyDown={props.editTrigger === "icon" ? undefined : (s) => {
            s.if(sql`event.key = 'Enter'`, (s) => {
              s.setScalar("editing", true);
            });
          }}
        >
          <Conditional
            when={sql`value is not null`}
            then={<InlineFieldDisplay field={field} value={sql`value`} />}
            else={props.placeholder ??
              <span sx={{ color: "text-tertiary" }}>(no value)</span>}
          />

          {props.editTrigger === "icon"
            ? (
              <IconButton
                variant="plain"
                color="neutral"
                size="xs"
                icon="Edit"
                aria-label={`Edit ${field.displayName}`}
                tooltip="Edit"
                onClick={(s) => {
                  s.event.stopPropagation();
                  s.setScalar("editing", true);
                }}
              />
            )
            : (
              <div
                sx={{
                  position: "relative",
                  right: 0,
                  top: 0,
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <MaterialIcon
                  icon="Edit"
                  fontSize="base"
                  sx={{
                    display: "none",
                    ":hover > div > &": {
                      display: "block",
                    },
                  }}
                />
              </div>
            )}
        </div>
      }
    />
  );
};

/**
 * Props for {@link Form.InlineEditMulti}, click-to-edit for several fields at
 * once on a record page (e.g. `first_name` + `last_name`).
 */
export interface FormInlineEditMultiProps {
  /** Names of the fields to edit together. */
  fields: string[];
  /** Builds the read-mode display expression from the field value expressions (in `fields` order). */
  display: (...values: Sql[]) => Sql;
  sx?: Style;
  /** Node shown when the combined display value is null. */
  placeholder?: Node;
}

/** Inline editing for multiple fields on a record page (e.g. first_name + last_name). */
Form.InlineEditMulti = function InlineEditMulti(
  props: FormInlineEditMultiProps,
) {
  const { currentTable } = useICtx(CurrentTableICtxKey);
  const fieldModels = props.fields.map((f) => {
    const field = currentTable.fields[f];
    if (!field) {
      throw new Error(
        `Field ${f} not found on table ${currentTable.name}`,
      );
    }
    return field;
  });
  const { currentRecordId } = useICtx(CurrentRecordICtxKey);
  const { triggerRefetch } = useICtx(CurrentRefetchICtxKey);
  useState((s) => {
    s.defScalar("editing", false);
    s.defScalar("refetch_key", 0);
  });
  useState({
    procedure: (s) => {
      s.defScalar(
        "display_value",
        sql`(select ${
          props.display(
            ...fieldModels.map((f) => sql.ref(f.name)),
          )
        } from ${currentTable.identWithDb} where id = ${currentRecordId})`,
      );
    },
    watch: [sql`refetch_key`],
  });

  function InlineMultiSaveComponent() {
    if (usePhase() === "gather") {
      return;
    }
    const ctx = useICtx(FormICtxKey);
    return (
      <>
        <IconButton
          variant="plain"
          color="primary"
          size="sm"
          aria-label="Save"
          onClick={(s) => {
            ctx.submit(s);
          }}
        >
          <MaterialIcon icon="Save" />
        </IconButton>
        <IconButton
          variant="plain"
          color="danger"
          size="sm"
          aria-label="Cancel"
          onClick={(s) => {
            s.setScalar("editing", false);
          }}
        >
          <MaterialIcon icon="Cancel" />
        </IconButton>
      </>
    );
  }

  return (
    <Conditional
      when={sql`editing`}
      then={
        <Form
          submitOnDocumentEnter
          afterSubmitClientSuccess={(s) => {
            s.setScalar("editing", false);
            s.increment("refetch_key");
            triggerRefetch(s);
          }}
        >
          <Form.Update
            table={currentTable.name}
            where={sql`id = ${currentRecordId}`}
          >
            <div
              sx={{
                display: "flex",
                flexDirection: "row",
                alignItems: "start",
                gap: 1,
              }}
            >
              {fieldModels.map((field, i) => (
                <Form.Field field={field.name}>
                  {() => {
                    if (usePhase() === "gather") {
                      return;
                    }
                    const helper = useFieldHelper();
                    return (
                      <FormControl>
                        <FieldFormControl
                          field={field}
                          placeholder={field.displayName}
                          immediateFocus={i === 0}
                        />
                        <Show when={helper.hasError}>
                          <div
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              fontSize: "sm",
                              lineHeight: "sm",
                              color: "danger-500",
                              mt: 0.75,
                            }}
                          >
                            {helper.error}
                          </div>
                        </Show>
                      </FormControl>
                    );
                  }}
                </Form.Field>
              ))}
              <InlineMultiSaveComponent />
            </div>
          </Form.Update>
        </Form>
      }
      else={
        <div
          sx={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 1,
            ...props.sx,
          }}
          onClick={(s) => {
            s.setScalar("editing", true);
          }}
          tabIndex={0}
          onKeyDown={(s) => {
            s.if(sql`event.key = 'Enter'`, (s) => {
              s.setScalar("editing", true);
            });
          }}
        >
          <Conditional
            when={sql`display_value is not null`}
            then={sql`display_value`}
            else={props.placeholder ??
              <span sx={{ color: "text-tertiary" }}>(no value)</span>}
          />

          <div
            sx={{
              position: "relative",
              right: 0,
              top: 0,
              height: "100%",
              display: "flex",
              alignItems: "center",
            }}
          >
            <MaterialIcon
              icon="Edit"
              fontSize="base"
              sx={{
                display: "none",
                ":hover > div > &": {
                  display: "block",
                },
              }}
            />
          </div>
        </div>
      }
    />
  );
};
