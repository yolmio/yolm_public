import { FieldFormControl } from "components/field_form_control";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { MaterialIcon } from "components/material_icon";
import { Menu } from "components/menu";
import { MultiSelectDropdown } from "components/multi_select_dropdown";
import { QueryCombobox } from "components/query_combobox";
import { Form } from "std/form";
import { type Sql, sql } from "std/sql_utils";
import type { DomStatements, StateStatements } from "std/statements";
import type { Variant } from "std/theme";
import type { Node } from "std/ui";
import type { TrainingBlock } from "../index.tsx";
import {
  employeeName,
  personLanguageSql,
  personPrimaryJobProfileSql,
  personTable,
  personTypeSql,
} from "../helpers";

function adminBasePath(block: TrainingBlock) {
  return block.opts.routes?.adminBasePath ?? "/training-admin";
}
export const adminSelectClass =
  "w-full border border-neutral-300 rounded-md px-3 py-2 bg-white";

export function defineAssignmentGroupScalars(
  s: StateStatements,
  opts: {
    prefix: string;
    block: TrainingBlock;
  },
) {
  s.defScalar(`${opts.prefix}_target`, sql.lit`audience`);
  s.defScalar(`${opts.prefix}_audience_id`, sql.lit``);
  if (opts.block.opts.workforce.personPrimaryJobProfileId) {
    s.defScalar(`${opts.prefix}_job_profile`, sql.lit``);
  }
  s.defScalar(`${opts.prefix}_person_type`, sql.lit``);
  s.defScalar(`${opts.prefix}_language`, sql.lit``);
}

export function AudienceMultiSelect(
  props: {
    selectedIdsScalar: string;
    availableItemsQuery: Sql;
    placeholder?: string;
  },
) {
  const selectedIds = sql.ref(props.selectedIdsScalar);
  return (
    <MultiSelectDropdown
      buttonVariant="outlined"
      buttonColor="neutral"
      buttonSize="md"
      buttonSx={{
        minHeight: "2.5rem",
        px: 1.5,
        py: "3px",
      }}
      placeholder={props.placeholder ?? "All people"}
      selectedItemsQuery={sql`coalesce(
        (
          select string_agg(audience.name, ', ' order by audience.name)
          from db.training_audiences audience
          where (',' || coalesce(${selectedIds}, '') || ',')
            like '%,' || audience.id::string || ',%'
        ),
        ${sql.lit(props.placeholder ?? "All people")}
      )`}
      availableItemsQuery={sql`
        select audience.id,
               audience.name,
               audience.description,
               (',' || coalesce(${selectedIds}, '') || ',')
                 like '%,' || audience.id::string || ',%' as is_selected
        from (${props.availableItemsQuery}) audience
      `}
      watch={[selectedIds]}
      onToggleItem={() => {
        return {
          onSelected: (s: DomStatements) => {
            s.setScalar(
              props.selectedIdsScalar,
              sql`case
                when coalesce(${selectedIds}, '') = '' then item.id::string
                else ${selectedIds} || ',' || item.id::string
              end`,
            );
          },
          onDeselected: (s: DomStatements) => {
            s.setScalar(
              props.selectedIdsScalar,
              sql`coalesce(
                (
                  select string_agg(value, ',' order by ordinal)
                  from string.split(coalesce(${selectedIds}, ''), ',')
                  where value != item.id::string
                    and value != ''
                ),
                ''
              )`,
            );
          },
        };
      }}
    />
  );
}

export function PersonMultiSelect(
  props: {
    block: TrainingBlock;
    selectedIdsScalar: string;
    availableItemsQuery: Sql;
    placeholder?: string;
    preserveSelectionOrder?: boolean;
    searchPlaceholder?: string;
  },
) {
  const selectedIds = sql.ref(props.selectedIdsScalar);
  const personDisplayName = employeeName(props.block.opts, sql`person`);
  const selectedItemsQuery = props.preserveSelectionOrder
    ? sql`coalesce(
        (
          select string_agg(${personDisplayName}, ', ' order by selected.ordinal)
          from string.split(coalesce(${selectedIds}, ''), ',') selected
          join db.${sql.ref(personTable(props.block.opts))} person
            on person.id::string = selected.value
          where selected.value != ''
        ),
        ${sql.lit(props.placeholder ?? "Choose people")}
      )`
    : sql`coalesce(
        (
          select string_agg(${personDisplayName}, ', ' order by ${personDisplayName})
          from db.${sql.ref(personTable(props.block.opts))} person
          where (',' || coalesce(${selectedIds}, '') || ',')
            like '%,' || person.id::string || ',%'
        ),
        ${sql.lit(props.placeholder ?? "Choose people")}
      )`;
  return (
    <MultiSelectDropdown
      buttonVariant="outlined"
      buttonColor="neutral"
      buttonSize="md"
      buttonSx={{
        minHeight: "2.5rem",
        px: 1.5,
        py: "3px",
      }}
      placeholder={props.placeholder ?? "Choose people"}
      searchPlaceholder={props.searchPlaceholder}
      selectedItemsQuery={selectedItemsQuery}
      availableItemsQuery={sql`
        select person.id,
               person.name,
               person.description,
               (',' || coalesce(${selectedIds}, '') || ',')
                 like '%,' || person.id::string || ',%' as is_selected
        from (${props.availableItemsQuery}) person
      `}
      watch={[selectedIds]}
      onToggleItem={() => {
        return {
          onSelected: (s: DomStatements) => {
            s.setScalar(
              props.selectedIdsScalar,
              sql`case
                when coalesce(${selectedIds}, '') = '' then item.id::string
                else ${selectedIds} || ',' || item.id::string
              end`,
            );
          },
          onDeselected: (s: DomStatements) => {
            s.setScalar(
              props.selectedIdsScalar,
              sql`coalesce(
                (
                  select string_agg(value, ',' order by ordinal)
                  from string.split(coalesce(${selectedIds}, ''), ',')
                  where value != item.id::string
                    and value != ''
                ),
                ''
              )`,
            );
          },
        };
      }}
    />
  );
}

export function pendingAssessmentReviewCountSql() {
  return sql`(
    select count(*)
    from db.training_assessment_attempts att
    where att.status = 'review_pending'
  )`;
}

export function defineAssignmentGroupTables(
  s: StateStatements,
  opts: {
    tablePrefix: string;
    block: TrainingBlock;
  },
) {
  s.defTable(
    `${opts.tablePrefix}_audiences`,
    sql`select id, name
        from db.training_audiences
        where is_active
        order by name`,
  );
  if (opts.block.opts.workforce.personPrimaryJobProfileId) {
    s.defTable(
      `${opts.tablePrefix}_job_profiles`,
      sql`select distinct ${
        personPrimaryJobProfileSql(opts.block.opts, sql`e`)
      } as job_profile
          from db.${sql.ref(personTable(opts.block.opts))} e
          where nullif(trim(${
        personPrimaryJobProfileSql(opts.block.opts, sql`e`)
      }), '') is not null
          order by job_profile`,
    );
  }
  s.defTable(
    `${opts.tablePrefix}_person_types`,
    sql`select distinct ${personTypeSql(opts.block.opts, sql`e`)} as person_type
        from db.${sql.ref(personTable(opts.block.opts))} e
        where nullif(trim(${
      personTypeSql(opts.block.opts, sql`e`)
    }), '') is not null
        order by person_type`,
  );
  s.defTable(
    `${opts.tablePrefix}_languages`,
    sql`select code, name
        from db.training_content_languages
        order by sort_order, name`,
  );
}

export function adminEmployeeHref(block: TrainingBlock, employeeId: Sql) {
  return sql`${sql.lit(adminBasePath(block))} || '/employee/' || ${employeeId}`;
}

export function adminCoursesHref(block: TrainingBlock) {
  return `${adminBasePath(block)}/courses`;
}

export function adminSectionTemplatesHref(block: TrainingBlock) {
  return `${adminBasePath(block)}/sections`;
}

export function adminCourseHref(block: TrainingBlock, courseId: Sql) {
  return sql`${sql.lit(adminBasePath(block))} || '/courses/' || ${courseId}`;
}

export function adminCourseAssignHref(block: TrainingBlock, courseId: Sql) {
  return sql`${
    sql.lit(adminBasePath(block))
  } || '/courses/' || ${courseId} || '/assign'`;
}

export function adminAssessmentsHref(block: TrainingBlock) {
  return `${adminBasePath(block)}/assessments`;
}

export function adminAssessmentHref(block: TrainingBlock, assessmentId: Sql) {
  return sql`${
    sql.lit(adminBasePath(block))
  } || '/assessments/' || ${assessmentId}`;
}

export function adminAssessmentReviewsHref(block: TrainingBlock) {
  return `${adminBasePath(block)}/assessment-reviews`;
}

export function adminAssessmentTaskHref(block: TrainingBlock, taskId: Sql) {
  return sql`${
    sql.lit(adminBasePath(block))
  } || '/assessment-tasks/' || ${taskId}`;
}

export function adminEmployeeCourseValidationHref(
  block: TrainingBlock,
  employeeId: Sql,
  assignmentId: Sql,
) {
  return sql`${
    sql.lit(adminBasePath(block))
  } || '/employee/' || ${employeeId} || '/course-validations/' || ${assignmentId}`;
}

export function adminPeopleHref(block: TrainingBlock) {
  return `${adminBasePath(block)}/people`;
}

/**
 * Rolls a freshly published document version out to everything that uses it:
 * sets the active published version for its language and swaps open
 * document assignment tasks. Call inside a transaction.
 */
export function notificationVariableToken(key: string) {
  return sql.lit`{{${key}}}`;
}

export function EmployeeAssignmentCombobox(props: {
  block: TrainingBlock;
  selectedPersonScalar: string;
}) {
  return (
    <QueryCombobox
      placeholder="Search employees..."
      clearOnSelect={false}
      populateResultTable={(s, query, resultTable) => {
        s.modify(sql`
          insert into ${resultTable}
            select name as label, rank() over () - 1 as index, id
            from (
              select e.id,
                     ${employeeName(props.block.opts, sql`e`)} as name,
                     ${personLanguageSql(props.block.opts, sql`e`)} as language
              from db.${sql.ref(personTable(props.block.opts))} e
            ) employee_search
            where trim(${query}) = ''
              or fuzzy_match(${query}, name)
              or fuzzy_match(${query}, language)
            order by
              case when trim(${query}) = '' then 0 else 1 end,
              fuzzy_rank_key(${query}, name),
              name
            limit 20
        `);
      }}
      onSelect={(s, result) => {
        s.setScalar(props.selectedPersonScalar, sql`${result}.id`);
      }}
      onClear={(s) => {
        s.setScalar(props.selectedPersonScalar, sql`null`);
      }}
      onBlur={() => {}}
    />
  );
}

export function NotificationVariableInsertMenu(props: {
  variables: Record<string, string>;
  onClick: (s: DomStatements, key: string) => void;
  variant?: Variant;
}) {
  return (
    <Menu>
      <Menu.Button
        variant={props.variant ?? "outlined"}
        color="neutral"
        className="w-fit"
        aria-controls="training-template-variables-menu"
        aria-haspopup="true"
        size="sm"
      >
        <MaterialIcon icon="Add" />
      </Menu.Button>
      <Menu.Content className="max-h-[220px] overflow-auto mr-4">
        {Object.entries(props.variables).map(([key, description]) => (
          <Menu.Item onClick={(s) => props.onClick(s, key)}>
            {sql.concat(
              notificationVariableToken(key),
              sql.lit`: `,
              sql.lit(description),
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu>
  );
}

export function TrainingAdminFrame(props: { children: Node }) {
  return (
    <div className="min-h-dvh bg-neutral-50 pb-8">
      <div className="px-4 py-5 md:px-8 md:py-8 max-w-7xl mx-auto flex flex-col gap-6">
        {props.children}
      </div>
    </div>
  );
}

export function LabeledFormField(props: {
  field: string;
  label: string;
  initialValue?: Sql;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <FormControl className={props.className}>
      <FormLabel>{props.label}</FormLabel>
      <Form.Field field={props.field} initialValue={props.initialValue}>
        <FieldFormControl
          placeholder={props.placeholder}
          required={props.required}
        />
      </Form.Field>
    </FormControl>
  );
}
