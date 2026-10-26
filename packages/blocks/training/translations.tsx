import { currentUserHasPermission } from "blocks/auth";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { system } from "std/system";
import {
  activeAssessmentVersionSql,
  activeCourseVersionSql,
  defaultLanguageSql,
  trainingPermissions,
} from "./helpers";
import type { TrainingBlockOpts } from "./types";

type TranslationSide = "source" | "draft";

interface TranslationFieldGroup {
  table: string;
  where: Sql;
  columns: [string, number][];
  /**
   * Identifies one row occurrence identically in the published source and in
   * the translation draft freshly cloned from it, so identical text in
   * different places can receive different translations.
   */
  locator: (side: TranslationSide) => Sql;
  /** Surrounding source text shown to the translator, or null. */
  context: Sql;
}

/** Text fields Spark may translate without changing links, answers or scoring. */
function translationFields(kind: "course" | "assessment", version: Sql) {
  const versionWhere = () =>
    sql`t.${sql.ref(`training_${kind}_version_id`)} = ${version}`;
  const sections = `training_${kind}_sections`;
  const items = kind === "course"
    ? "training_course_section_items"
    : "training_assessment_items";
  const sectionFk = `training_${kind}_section_id`;
  const itemWhere = sql`t.${sql.ref(sectionFk)} in (select id from db.${
    sql.ref(sections)
  } where ${sql.ref(`training_${kind}_version_id`)} = ${version})`;
  const itemIds = sql`select i.id from db.${sql.ref(items)} i join db.${
    sql.ref(sections)
  } s on s.id = i.${sql.ref(sectionFk)} where s.${
    sql.ref(`training_${kind}_version_id`)
  } = ${version}`;
  // Draft rows carry the id of the source row they were cloned from.
  const cloneKey = (column: string, side: TranslationSide) =>
    side === "source" ? sql`t.id::string` : sql`t.${sql.ref(column)}::string`;
  const sourceItem = (itemFk: string, side: TranslationSide) =>
    side === "source"
      ? sql`t.${sql.ref(itemFk)}`
      : sql`(select i.source_item_id from db.${
        sql.ref(items)
      } i where i.id = t.${sql.ref(itemFk)})`;
  const sectionName = sql`(select name from db.${
    sql.ref(sections)
  } where id = t.${sql.ref(sectionFk)})`;
  const fields: TranslationFieldGroup[] = [
    {
      table: `training_${kind}_versions`,
      where: sql`t.id = ${version}`,
      columns: [["localized_name", 200], ["localized_description", 2000]],
      locator: () => sql`''`,
      context: sql`null`,
    },
    {
      table: sections,
      where: versionWhere(),
      columns: [["name", 255], ["description", 1000]],
      locator: (side) => cloneKey("source_section_id", side),
      context: sql`null`,
    },
    {
      table: items,
      where: itemWhere,
      columns: kind === "course"
        ? [["content", 255], ["essay_prompt", 1000], ["external_title", 255]]
        : [["prompt", 2000], ["help_text", 1000], ["explanation", 2000], [
          "remediation_text",
          2000,
        ]],
      locator: (side) => cloneKey("source_item_id", side),
      context: sql`'Section: ' || ${sectionName}`,
    },
  ];
  if (kind === "course") {
    const itemFk = "training_course_section_item_id";
    fields.push({
      table: "training_course_section_item_documents",
      where: sql`t.${sql.ref(itemFk)} in (${itemIds})`,
      columns: [["label", 255]],
      locator: (side) =>
        sql`${
          sourceItem(itemFk, side)
        }::string || ':' || t.document_id::string || ':' || (row_number() over (partition by t.${
          sql.ref(itemFk)
        }, t.document_id order by t.sort_order, t.label, t.id))::string`,
      context:
        sql`'Task: ' || (select content from db.training_course_section_items where id = t.${
          sql.ref(itemFk)
        })`,
    });
  } else {
    const itemFk = "training_assessment_item_id";
    const fieldKey =
      sql`(select f.key from db.training_assessment_metadata_fields f where f.id = t.training_assessment_metadata_field_id)`;
    fields.push(
      {
        table: "training_assessment_item_choices",
        where: sql`t.${sql.ref(itemFk)} in (${itemIds})`,
        columns: [["content", 1000], ["explanation", 1000]],
        locator: (side) =>
          sql`${
            sourceItem(itemFk, side)
          }::string || ':' || (row_number() over (partition by t.${
            sql.ref(itemFk)
          } order by t.sort_order, t.content, t.is_correct, t.explanation, t.id))::string`,
        context:
          sql`'Question: ' || (select prompt from db.training_assessment_items where id = t.${
            sql.ref(itemFk)
          })`,
      },
      {
        table: "training_assessment_metadata_fields",
        where: versionWhere(),
        columns: [["label", 255], ["help_text", 1000]],
        locator: () => sql`t.key`,
        context: sql`null`,
      },
      {
        table: "training_assessment_metadata_field_choices",
        where:
          sql`t.training_assessment_metadata_field_id in (select id from db.training_assessment_metadata_fields where training_assessment_version_id = ${version})`,
        columns: [["label", 255]],
        locator: () =>
          sql`${fieldKey} || ':' || (row_number() over (partition by t.training_assessment_metadata_field_id order by t.sort_order, t.value, t.label, t.id))::string`,
        context:
          sql`'Field: ' || (select f.label from db.training_assessment_metadata_fields f where f.id = t.training_assessment_metadata_field_id)`,
      },
    );
  }
  return fields;
}

/**
 * One row per translatable occurrence. `key` numbers occurrences for Spark;
 * `locator` finds the same occurrence in the cloned draft.
 */
function sourceTextQuery(kind: "course" | "assessment", version: Sql) {
  const queries = translationFields(kind, version).flatMap((group) =>
    group.columns.map(([column, maxLength]) => {
      const value = group.table.endsWith("_versions")
        ? sql`case when t.localized_name is null then (select ${
          sql.ref(column === "localized_name" ? "name" : "description")
        } from db.${sql.ref(`training_${kind}s`)} where id = t.${
          sql.ref(`training_${kind}_id`)
        }) else t.${sql.ref(column)} end`
        : sql`t.${sql.ref(column)}`;
      return sql`select ${sql.lit(`${group.table}.${column}`)} as field_key, ${
        group.locator("source")
      } as locator, ${value} as original_text, ${group.context}::string as context, ${maxLength} as max_length from db.${
        sql.ref(group.table)
      } t where ${group.where}`;
    })
  );
  if (kind === "course") {
    queries.push(
      sql`select 'rich_text' as field_key, entry.value->>'path' as locator, entry.value->>'text' as original_text, entry.value->>'context' as context, 10000 as max_length from db.training_course_versions v cross join json.array_each(fn.training_rich_text_entries(v.introduction, '', null)) entry where v.id = ${version}`,
    );
  }
  return sql`select row_number() over(order by field_key, locator) as key, field_key, locator, original_text, context, max_length from (${
    sql.unionAll(...queries)
  }) texts where nullif(trim(original_text), '') is not null`;
}

/**
 * Locators of one group's draft rows, materialized before the update because
 * they may use window functions.
 */
function draftLocatorsQuery(group: TranslationFieldGroup) {
  return sql`select t.id, ${group.locator("draft")} as locator from db.${
    sql.ref(group.table)
  } t where ${group.where}`;
}

export function registerTrainingTranslationProcedures(opts: TrainingBlockOpts) {
  // Lexical text/altText occurrences in document order. Each path names the
  // node by its child indexes ('r.0.1'), so a cloned introduction yields the
  // same paths; context is the enclosing block's full text.
  system.db.scalarFunction({
    name: "training_rich_text_entries",
    parameters: [
      { name: "node", type: "Json" },
      { name: "path", type: { type: "String", maxLength: 1000 } },
      { name: "context", type: { type: "String", maxLength: 10000 } },
    ],
    returnType: "Json",
    procedure: (s) => {
      s.if(
        sql`json_typeof(input.node) = 'array'`,
        (s) =>
          s.return(
            sql`(select coalesce(json_array_agg(entry.value order by child.index, entry.index), '[]'::json) from json.array_each(input.node) child cross join json.array_each(fn.training_rich_text_entries(child.value, input.path || '.' || child.index::string, input.context)) entry)`,
          ),
      );
      s.if(
        sql`json_typeof(input.node) is distinct from 'object'`,
        (s) => s.return(sql`'[]'::json`),
      );
      s.defScalar(
        "block_context",
        sql`case when input.node->>'type' in ('paragraph', 'heading', 'quote', 'listitem', 'tablecell')
          then (select string_agg(text_node.value->>'text', '' order by text_node.index) from json.array_each(fn.lexical_extract_nodes(json_build_object('root', json_build_object('children', json_build_array(input.node))), 'text')) text_node)
          else input.context end`,
      );
      s.defScalar(
        "own_field",
        sql`case input.node->>'type' when 'text' then 'text' when 'image' then 'altText' end`,
      );
      s.return(
        sql`(case when own_field is not null and input.node->>own_field is not null
          then json_build_array(json_build_object('path', input.path || ':' || own_field, 'text', input.node->>own_field, 'context', block_context))
          else '[]'::json end)
        || (case when input.node->'root' is not null then fn.training_rich_text_entries(input.node->'root', 'r', null) else '[]'::json end)
        || (case when json_typeof(input.node->'children') = 'array' then fn.training_rich_text_entries(input.node->'children', input.path, block_context) else '[]'::json end)`,
      );
    },
  });

  // Rebuild Lexical JSON while replacing only text/altText values, keyed by
  // training_rich_text_entries paths. All formatting, image URLs, link URLs,
  // IDs and other properties remain application-owned.
  system.db.scalarFunction({
    name: "training_translate_rich_text",
    parameters: [
      { name: "node", type: "Json" },
      { name: "translations", type: "Json" },
      { name: "path", type: { type: "String", maxLength: 1000 } },
    ],
    returnType: "Json",
    procedure: (s) => {
      s.if(
        sql`json_typeof(input.node) = 'array'`,
        (s) =>
          s.return(
            sql`(select coalesce(json_array_agg(fn.training_translate_rich_text(value, input.translations, input.path || '.' || index::string) order by index), '[]'::json) from json.array_each(input.node))`,
          ),
      );
      s.if(
        sql`json_typeof(input.node) = 'object'`,
        (s) =>
          s.return(
            sql`(select coalesce(json_object_agg(key, case
              when key = 'root' then fn.training_translate_rich_text(value, input.translations, 'r')
              when key = 'children' then fn.training_translate_rich_text(value, input.translations, input.path)
              when (input.node->>'type' = 'text' and key = 'text') or (input.node->>'type' = 'image' and key = 'altText') then coalesce(input.translations->(input.path || ':' || key), value)
              else value end), '{}'::json) from json.object_each(input.node))`,
          ),
      );
      s.return(sql`input.node`);
    },
  });

  for (const kind of ["course", "assessment"] as const) {
    const permission = kind === "course"
      ? trainingPermissions.manageLibrary
      : trainingPermissions.manageAssessments;
    const active = kind === "course"
      ? activeCourseVersionSql
      : activeAssessmentVersionSql;
    const versions = `training_${kind}_versions`;
    const fk = `training_${kind}_id`;
    system.storedProcedure({
      name: `training_save_${kind}_translation`,
      transaction: "caller",
      inputScalars: [
        { name: "p_id", type: "BigInt" },
        { name: "p_language", type: { type: "String", maxLength: 20 } },
        { name: "p_source_id", type: "BigInt" },
        { name: "p_translation", type: "Json" },
      ],
      procedure: (s) => {
        s.throwErrorUnless(
          currentUserHasPermission(sql.lit(permission)),
          sql.lit`You do not have permission to translate this content.`,
        );
        s.throwErrorUnless(
          sql.inList(
            sql`p_language`,
            opts.content.opts.languages.map((l) => sql.lit(l.code)),
          ),
          sql.lit`Choose a supported language.`,
        );
        s.throwErrorIf(
          sql`p_language = ${defaultLanguageSql(opts)}`,
          sql.lit`Choose a translation language.`,
        );
        s.defScalar("translation_source_id", sql`p_source_id`);
        s.throwErrorUnless(
          sql`p_source_id is not null and ${active(sql`p_id`)} = p_source_id`,
          sql.lit`The source version changed. Please try again.`,
        );
        s.defTable(
          "translation_source",
          sourceTextQuery(kind, sql`translation_source_id`),
        );
        s.defScalar("translated_json", sql`p_translation`);
        s.throwErrorUnless(
          sql`coalesce(json_typeof(translated_json->'translations') = 'array', false)`,
          sql.lit`The translation response was invalid. No draft was saved.`,
        );
        s.defTable(
          "translated_text",
          sql`select try_cast(value->>'key' as bigint) as key, value->>'text' as text, json_typeof(value->'text') as text_type from json.array_each(translated_json->'translations')`,
        );
        s.throwErrorUnless(
          sql`(select count(*) from translated_text) = (select count(*) from translation_source)
          and (select count(distinct key) from translated_text) = (select count(*) from translation_source)
          and not exists (select 1 from translated_text result left join translation_source source on source.key = result.key where source.key is null or result.text_type != 'string' or nullif(trim(result.text),'') is null or length(result.text) > source.max_length)`,
          sql
            .lit`The translation was incomplete or exceeded a field limit. No draft was saved. Please try again.`,
        );
        s.throwErrorIf(
          sql`exists (select 1 from db.${sql.ref(versions)} where ${
            sql.ref(fk)
          } = p_id and language = p_language and status = 'draft')`,
          sql
            .lit`Another draft was created during translation. Your existing draft has been preserved.`,
        );
        s.callStoredProcedure(`training_ensure_${kind}_draft_language`, {
          inputScalars: {
            [`p_${kind}_id`]: sql`p_id`,
            p_language: sql`p_language`,
            p_source_version: sql`translation_source_id`,
          },
          outputScalars: kind === "course"
            ? {
              draft_course_version_id: "translation_draft_id",
              source_course_version_id: "translation_clone_source_id",
            }
            : { draft_assessment_version_id: "translation_draft_id" },
        });
        translationFields(kind, sql`translation_draft_id`).forEach(
          (group, index) => {
            const locators = `translation_draft_locators_${index}`;
            s.defTable(locators, draftLocatorsQuery(group));
            for (const [column] of group.columns) {
              s.modify(
                sql`update db.${sql.ref(group.table)} as t set ${
                  sql.ref(column)
                } = coalesce((select result.text from ${
                  sql.ref(locators)
                } draft join translation_source source on source.locator = draft.locator join translated_text result on result.key = source.key where draft.id = t.id and source.field_key = ${
                  sql.lit(`${group.table}.${column}`)
                }), t.${sql.ref(column)}) where ${group.where}`,
              );
            }
          },
        );
        if (kind === "course") {
          s.defScalar(
            "rich_translations",
            sql`(select coalesce(json_object_agg(source.locator,result.text), '{}'::json) from translation_source source join translated_text result on result.key = source.key where source.field_key = 'rich_text')`,
          );
          s.modify(
            sql`update db.training_course_versions set introduction = fn.training_translate_rich_text(introduction, rich_translations, '') where id = translation_draft_id`,
          );
        }
      },
    });
    system.storedProcedure({
      name: `training_${kind}_translation_source`,
      inputScalars: [{ name: "p_id", type: "BigInt" }],
      outputScalars: [{ name: "translation_source", type: "Json" }],
      procedure: (s) => {
        s.throwErrorUnless(
          currentUserHasPermission(sql.lit(permission)),
          sql
            .lit`You do not have permission to translate this training content.`,
        );
        s.defScalar("translation_source_id", active(sql`p_id`));
        s.throwErrorIf(
          sql`translation_source_id is null`,
          sql.lit`Publish the default-language version before translating.`,
        );
        s.defTable(
          "source_text",
          sourceTextQuery(kind, sql`translation_source_id`),
        );
        s.setScalar(
          "translation_source",
          sql`json_build_object(
          'source_version_id', translation_source_id,
          'source_language', ${defaultLanguageSql(opts)},
          'dependencies', ${
            kind === "course"
              ? sql`(select coalesce(json_array_agg(json_build_object('kind', kind, 'id', id)), '[]'::json) from (
              select distinct 'assessment' as kind, item.training_assessment_id as id
              from db.training_course_section_items item join db.training_course_sections section on section.id = item.training_course_section_id
              where section.training_course_version_id = translation_source_id and item.training_assessment_id is not null
              union
              select distinct 'course', item.other_course_id
              from db.training_course_section_items item join db.training_course_sections section on section.id = item.training_course_section_id
              where section.training_course_version_id = translation_source_id and item.other_course_id is not null
            ) dependencies)`
              : sql`'[]'::json`
          },
          'texts', (select json_array_agg(json_build_object(
            'key', key, 'field', field_key, 'text', original_text, 'context', context, 'max_length', max_length
          ) order by key) from source_text))`,
        );
      },
    });
  }
}
