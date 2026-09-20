import {
  type DriveBlock,
  type DriveSpaceAccess,
  type DriveSpaceType,
  MarkdownDocumentExtension,
} from "blocks/drive";
import { type Sql, sql } from "std/sql_utils";

const normalizedMarkdown = (content: Sql) =>
  sql`replace(replace(${content}, chr(13) || chr(10), chr(10)), chr(13), chr(10))`;

const normalizedSkillDocumentScalar = (value: Sql) =>
  sql`replace(replace(
    trim(${value}),
    chr(13) || chr(10), ' '
  ), chr(10), ' ')`;

function skillFrontmatterHeader(content: Sql): Sql {
  const normalized = normalizedMarkdown(content);
  const body = sql`substring(${normalized} from 5)`;
  const closing = sql`position(chr(10) || '---' || chr(10) in ${body})`;
  return sql`case
    when left(${normalized}, 4) = '---' || chr(10)
      and ${closing} > 0
    then left(${body}, ${closing} - 1)
    else null
  end`;
}

/** Removes a valid leading frontmatter block for rendered skill previews. */
export function sparkSkillRenderedContent(content: Sql): Sql {
  const normalized = normalizedMarkdown(content);
  const body = sql`substring(${normalized} from 5)`;
  const closing = sql`position(chr(10) || '---' || chr(10) in ${body})`;
  return sql`case
    when left(${normalized}, 4) = '---' || chr(10)
      and ${closing} > 0
    then substring(${body} from ${closing} + 5)
    else ${content}
  end`;
}

/** Reads one top-level, single-line scalar from a skill's YAML frontmatter. */
export function sparkSkillFrontmatterValue(
  content: Sql,
  key: "name" | "description",
): Sql {
  const header = skillFrontmatterHeader(content);
  const value = sql`trim(split_part(split_part(
    chr(10) || ${header} || chr(10),
    chr(10) || ${sql.lit(key + ":")},
    2
  ), chr(10), 1))`;
  const unquoted = sql`substring(${value} from 2 for length(${value}) - 2)`;
  return sql`case
    when ${header} is null then null
    when left(${value}, 1) = '"' and right(${value}, 1) = '"'
      then nullif(replace(replace(
        ${unquoted}, chr(92) || '"', '"'
      ), chr(92) || chr(92), chr(92)), '')
    else nullif(${value}, '')
  end`;
}

function sparkSkillFieldsValid(name: Sql, description: Sql): Sql {
  return sql`
    regex.is_match(coalesce(${name}, ''), '^[a-z0-9]+(-[a-z0-9]+)*$')
    and length(${name}) <= 64
    and nullif(${description}, '') is not null
    and length(${description}) <= 1024
    and position('<' in ${description}) = 0
    and position('>' in ${description}) = 0
  `;
}

/** Validates the standard discovery fields Spark supports in SKILL.md. */
export function sparkSkillFrontmatterValid(content: Sql): Sql {
  return sparkSkillFieldsValid(
    sparkSkillFrontmatterValue(content, "name"),
    sparkSkillFrontmatterValue(content, "description"),
  );
}

/** Validates form fields before they are serialized into a Spark skill document. */
export function sparkSkillDefinitionFieldsValid(opts: {
  name: Sql;
  description: Sql;
  instructions: Sql;
}): Sql {
  const fieldsValid = sparkSkillFieldsValid(
    normalizedSkillDocumentScalar(opts.name),
    normalizedSkillDocumentScalar(opts.description),
  );
  return sql`(
    ${fieldsValid}
    and ${opts.instructions} is not null
  )`;
}

/** Produces the standard Spark skill document shape used by UI and seeding. */
export function sparkSkillDocumentContent(opts: {
  name: Sql;
  description: Sql;
  instructions: Sql;
}): Sql {
  const scalar = (value: Sql) => {
    const normalized = normalizedSkillDocumentScalar(value);
    return sql`replace(replace(
      ${normalized}, chr(92), chr(92) || chr(92)
    ), '"', chr(92) || '"')`;
  };
  return sql`'---' || chr(10)
    || 'name: "' || ${scalar(opts.name)} || '"' || chr(10)
    || 'description: "' || ${scalar(opts.description)} || '"' || chr(10)
    || '---' || chr(10) || chr(10)
    || trim(${opts.instructions})`;
}

export interface SparkWorkspaceType {
  readonly spaceType: DriveSpaceType;
  readonly markdown: MarkdownDocumentExtension;
}

export interface SparkWorkspace {
  readonly drive: DriveBlock;
  readonly type: SparkWorkspaceType;
}

/**
 * Declares Spark's single, standalone Drive space. AGENTS.md and skill
 * SKILL.md files are its configuration contract; Markdown is the only content
 * representation.
 */
export function sparkSpaceType(opts: {
  access: DriveSpaceAccess;
  name?: string;
  displayName?: string;
}): SparkWorkspaceType {
  const markdown = new MarkdownDocumentExtension();
  return {
    markdown,
    spaceType: {
      name: opts.name ?? "spark",
      displayName: opts.displayName ?? "Spark",
      itemOrdering: "name",
      blobUploads: false,
      access: opts.access,
      extensions: [markdown],
    },
  };
}
