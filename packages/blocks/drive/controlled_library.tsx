import { Button } from "components/button";
import { Chip } from "components/chip";
import { Input } from "components/input";
import { MaterialIcon } from "components/material_icon";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import { Each, Show } from "std/ui";
import type { Node } from "std/ui";
import type { DriveBlock } from "./index.tsx";
import { driveText } from "./i18n";
import { FileViewer } from "./viewer";
import { lifecycleSpaceType } from "./controlled_lifecycle";
import type { ControlledFileLifecycle } from "./controlled_lifecycle.tsx";

export interface ControlledFileLibraryProps {
  files: DriveBlock;
  control: ControlledFileLifecycle;
  preferredLanguage: AnyExpr;
  fileHref: (fileItemId: Sql, language: Sql) => Sql;
  title?: Node;
  description?: Node;
  spaceId?: AnyExpr;
  /** Omit for all folders; SQL NULL lists files at the space root. */
  parentItemId?: AnyExpr;
  /** Folder navigation supplied by the application, below the library header. */
  children?: Node;
}

/**
 * Searchable, language-aware library of published governed files. Folder
 * placement and tags come from Drive; publication state comes from the
 * controlled lifecycle.
 */
export function ControlledFileLibrary(
  props: ControlledFileLibraryProps,
) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("controlled_library_search", sql.lit``);
      }}
    >
      <Data
        procedure={(s) => {
          s.defTable(
            "published_controlled_documents",
            sql`
              select
                item.id as file_item_id,
                item.name,
                item.description,
                revision.id as controlled_revision_id,
                revision.revision_label,
                revision.effective_on,
                revision.file_version_id,
                variant.language,
                (
                  select string_agg(
                    tag.name,
                    ', '
                    order by tag.name collate nocase
                  )
                  from db.file_tag_assignments assignment
                  join db.file_tags tag on tag.id = assignment.file_tag_id
                  where assignment.file_item_id = item.id
                ) as tag_names,
                (
                  select count(*)
                  from db.controlled_file_language_variants language_variant
                  where language_variant.file_item_id = item.id
                    and language_variant.current_controlled_file_revision_id
                      is not null
                ) as language_count
              from db.file_items item
              join db.file_spaces space on space.id = item.file_space_id
              join db.controlled_file_revisions revision
                on revision.id = ${
              props.control.resolvePreferredPublishedRevision({
                fileItemId: sql`item.id`,
                preferredLanguage: props.preferredLanguage as Sql,
              })
            }
              join db.controlled_file_language_variants variant
                on variant.id =
                  revision.controlled_file_language_variant_id
              where item.trashed_at is null
                ${
              props.spaceId
                ? sql`and item.file_space_id = ${props.spaceId}`
                : sql``
            }
                ${
              props.parentItemId !== undefined
                ? sql`and (item.parent_file_item_id = ${props.parentItemId}
                    or (item.parent_file_item_id is null and ${props.parentItemId} is null))`
                : sql``
            }
                and ${
              props.files.accessForSpaceRecordSql(
                sql`space`,
                sql`current_user`,
                "read",
              )
            }
                and (
                  trim(ui.controlled_library_search) = ''
                  or item.name like
                    ('%' || trim(ui.controlled_library_search) || '%')
                      collate nocase
                  or coalesce(item.description, '') like
                    ('%' || trim(ui.controlled_library_search) || '%')
                      collate nocase
                  or coalesce((
                    select string_agg(search_tag.name, ' ')
                    from db.file_tag_assignments search_assignment
                    join db.file_tags search_tag
                      on search_tag.id = search_assignment.file_tag_id
                    where search_assignment.file_item_id = item.id
                  ), '') like
                    ('%' || trim(ui.controlled_library_search) || '%')
                      collate nocase
                )
              order by item.name collate nocase
            `,
          );
        }}
      >
        <section>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <Typography level="h3">
                {props.title ?? driveText("policyLibrary")}
              </Typography>
              <p className="mt-1 max-w-2xl text-sm text-secondary">
                {props.description ?? driveText("policyLibraryDescription")}
              </p>
            </div>
            <Input
              bindScalar="controlled_library_search"
              placeholder={driveText("searchPolicies")}
              startDecorator={<MaterialIcon icon="Search" />}
              className="w-full sm:w-80"
            />
          </div>
          {props.children}
          <Show
            when={sql`exists (select 1 from published_controlled_documents)`}
            fallback={
              <div className="mt-8 rounded-xl border border-dashed border-divider bg-surface p-10 text-center">
                <MaterialIcon
                  icon="Policy"
                  className="text-5xl text-secondary"
                />
                <Typography level="title-lg" className="mt-3">
                  {driveText(
                    props.parentItemId !== undefined
                      ? "noPublishedPoliciesInFolder"
                      : "noPublishedPolicies",
                  )}
                </Typography>
                <p className="mt-1 text-sm text-secondary">
                  {driveText("publishedPoliciesAppear")}
                </p>
              </div>
            }
          >
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Each
                table="published_controlled_documents"
                recordName="published_document"
              >
                <a
                  href={props.fileHref(
                    sql`published_document.file_item_id`,
                    sql`published_document.language`,
                  )}
                  className="group rounded-xl border border-divider bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                      <MaterialIcon icon="Policy" />
                    </div>
                    <div className="flex gap-1">
                      <Chip size="sm" color="success" variant="soft">
                        {driveText("current")}
                      </Chip>
                      <Show when={sql`published_document.language_count > 1`}>
                        <Chip size="sm" variant="outlined">
                          {sql`upper(published_document.language)`}
                        </Chip>
                      </Show>
                    </div>
                  </div>
                  <Typography level="title-lg" className="mt-4">
                    {sql`published_document.name`}
                  </Typography>
                  <Show
                    when={sql`coalesce(published_document.description, '') <> ''`}
                  >
                    <p className="mt-1 line-clamp-2 text-sm text-secondary">
                      {sql`published_document.description`}
                    </p>
                  </Show>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-secondary">
                    <span>
                      {sql`${driveText("revision")} || ' ' ||
                        published_document.revision_label`}
                    </span>
                    <span>•</span>
                    <span>
                      {sql`format.date(
                        published_document.effective_on,
                        ${driveText("dateFormat")}
                      )`}
                    </span>
                  </div>
                  <Show
                    when={sql`coalesce(published_document.tag_names, '') <> ''`}
                  >
                    <p className="mt-3 truncate text-xs text-secondary">
                      {sql`published_document.tag_names`}
                    </p>
                  </Show>
                </a>
              </Each>
            </div>
          </Show>
        </section>
      </Data>
    </Data>
  );
}

export interface PublishedControlledFileProps {
  files: DriveBlock;
  control: ControlledFileLifecycle;
  fileItemId: AnyExpr;
  language: AnyExpr;
  backHref: string;
  fileHref: (fileItemId: Sql, language: Sql) => Sql;
}

/** Exact-version reader for a published controlled file. */
export function PublishedControlledFile(
  props: PublishedControlledFileProps,
) {
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "published_controlled_document",
          sql`
            select
              item.id as file_item_id,
              item.name,
              item.description,
              item.file_space_id,
              revision.id as controlled_revision_id,
              revision.revision_label,
              revision.effective_on,
              revision.file_version_id,
              revision.change_summary,
              variant.language
            from db.file_items item
            join db.file_spaces space on space.id = item.file_space_id
            join db.controlled_file_revisions revision
              on revision.id = ${
            props.control.resolvePreferredPublishedRevision({
              fileItemId: sql`item.id`,
              preferredLanguage: props.language as Sql,
            })
          }
            join db.controlled_file_language_variants variant
              on variant.id =
                revision.controlled_file_language_variant_id
            where item.id = ${props.fileItemId}
              and item.trashed_at is null
              and ${
            props.files.accessForSpaceRecordSql(
              sql`space`,
              sql`current_user`,
              "read",
            )
          }
          `,
        );
        s.defTable(
          "published_document_languages",
          sql`
            select
              variant.language,
              revision.revision_label
            from db.controlled_file_language_variants variant
            join db.controlled_file_revisions revision
              on revision.id =
                variant.current_controlled_file_revision_id
            where variant.file_item_id =
              ${props.fileItemId}
              and revision.controlled_file_language_variant_id = variant.id
              and revision.status = 'published'
              and revision.effective_on <= current_date()
            order by variant.language
          `,
        );
      }}
    >
      <main className="mx-auto max-w-screen-xl p-4 sm:p-6">
        <Button
          href={props.backHref}
          backLink
          variant="plain"
          startIcon="ArrowBack"
        >
          {driveText("backToPolicyLibrary")}
        </Button>
        <Show
          when={sql`published_controlled_document.file_item_id is not null`}
          fallback={
            <div className="mt-8 rounded-xl border border-divider bg-surface p-10 text-center">
              <MaterialIcon
                icon="Lock"
                className="text-5xl text-secondary"
              />
              <Typography level="h4" className="mt-2">
                {driveText("publishedDocumentUnavailable")}
              </Typography>
            </div>
          }
        >
          <header className="my-5 rounded-xl border border-divider bg-surface p-5">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color="success" variant="soft">
                    {driveText("approved")}
                  </Chip>
                  <Chip variant="outlined">
                    {sql`${driveText("revision")} || ' ' ||
                      published_controlled_document.revision_label`}
                  </Chip>
                  <Chip variant="outlined">
                    {sql`upper(published_controlled_document.language)`}
                  </Chip>
                </div>
                <Typography level="h2" className="mt-3">
                  {sql`published_controlled_document.name`}
                </Typography>
                <Show
                  when={sql`coalesce(published_controlled_document.description, '') <> ''`}
                >
                  <p className="mt-2 text-secondary">
                    {sql`published_controlled_document.description`}
                  </p>
                </Show>
                <p className="mt-3 text-sm text-secondary">
                  {sql`${driveText("effective")} || ' ' || format.date(
                    published_controlled_document.effective_on,
                    ${driveText("dateFormat")}
                  )`}
                </p>
              </div>
              <Show
                when={sql`(select count(*) from published_document_languages) > 1`}
              >
                <div className="flex flex-wrap gap-2">
                  <Each
                    table="published_document_languages"
                    recordName="published_language"
                  >
                    <Button
                      size="sm"
                      variant="outlined"
                      href={props.fileHref(
                        sql`published_controlled_document.file_item_id`,
                        sql`published_language.language`,
                      )}
                    >
                      {sql`upper(published_language.language)`}
                    </Button>
                  </Each>
                </div>
              </Show>
            </div>
          </header>
          <FileViewer
            files={props.files}
            fileItemId={sql`published_controlled_document.file_item_id`}
            fileVersionId={sql`published_controlled_document.file_version_id`}
            controlledRevisionId={sql`published_controlled_document.controlled_revision_id`}
            readOnly
            presentation="governed"
            spaceType={lifecycleSpaceType(props.files, props.control)}
          />
        </Show>
      </main>
    </Data>
  );
}
