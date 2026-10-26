import { Alert } from "components/alert";
import { Button } from "components/button";
import { Typography } from "components/typography";
import { Input } from "components/input";
import { FormControl } from "components/form_control";
import { FormLabel } from "components/form_label";
import { EmbeddedVideo } from "components/embedded_video";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { Form } from "std/form";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Show } from "std/ui";
import type { DriveBlock } from "./index";
import type { ControlledFileLifecycle } from "./controlled_lifecycle";
import type { DriveSpaceType } from "./types";
import { DriveFileUploadButton, DriveWorkspace } from "./workspace";
import { FileViewer } from "./viewer";
import { ExternalLinkExtension, isVideoSource } from "./external_link";

interface PublishedFilesProps {
  files: DriveBlock;
  control: ControlledFileLifecycle;
  type: DriveSpaceType;
  basePath: string;
}

function supportsVideoLinks(type: DriveSpaceType) {
  return type.extensions.some((extension) =>
    extension instanceof ExternalLinkExtension &&
    extension.supportsVideoSpace(type.name)
  );
}

function VideoLinkForm(props: {
  spaceId: Sql;
  parentItemId?: Sql;
  itemId?: Sql;
  language: string;
  label: string;
  basePath: string;
  initialUrl?: Sql;
}) {
  return (
    <Data
      local
      procedure={(s) => {
        s.defScalar("video_link_form_open", sql.false);
        s.defScalar("video_link_saved_item_id", sql`cast(null as bigint)`);
      }}
    >
      <Button
        variant="outlined"
        startIcon="Link"
        onClick={(s) =>
          s.setScalar("video_link_form_open", sql`not video_link_form_open`)}
      >
        {props.label}
      </Button>
      <Show when={sql`video_link_form_open`}>
        <div className="mt-3 w-full max-w-2xl space-y-3">
          <Form
            beforeTransactionCommit={(s) => {
              s.callStoredProcedure("external_video_save", {
                inputScalars: {
                  p_item_id: props.itemId ?? sql.null,
                  p_space_id: props.spaceId,
                  p_parent_id: props.parentItemId ?? sql.null,
                  p_name: props.itemId
                    ? sql.null
                    : sql`ui.video_link_input.name`,
                  p_url: sql`ui.video_link_input.url`,
                  p_language: sql.lit(props.language),
                  p_user_id: sql`current_user`,
                },
                outputScalars: { item_id: "saved_video_item_id" },
              });
            }}
            afterTransactionCommit={(s) =>
              s.setScalar(
                "ui.video_link_saved_item_id",
                sql`saved_video_item_id`,
              )}
            afterSubmitClientSuccess={(s) => {
              s.setScalar("video_link_form_open", sql.false);
              if (!props.itemId) {
                s.navigate(
                  sql`${
                    sql.lit(props.basePath)
                  } || '/' || video_link_saved_item_id::string`,
                );
              }
            }}
          >
            <Form.Temporary name="video_link_input">
              <div className="space-y-3">
                {!props.itemId && (
                  <Form.Field
                    field="name"
                    fieldType={{ type: "String", maxLength: 500 }}
                    required
                    initialValue={sql.lit``}
                  >
                    {(field) => (
                      <FormControl>
                        <FormLabel>Video title</FormLabel>
                        <Input
                          aria-label="Video title"
                          value={field.value}
                          maxLength={500}
                          onInput={(s) => field.setValue(s, sql`target_value`)}
                        />
                      </FormControl>
                    )}
                  </Form.Field>
                )}
                <Form.Field
                  field="url"
                  fieldType={{ type: "String", maxLength: 2000 }}
                  required
                  initialValue={props.initialUrl ?? sql.lit``}
                >
                  {(field) => (
                    <>
                      <FormControl>
                        <FormLabel>Video link</FormLabel>
                        <Input
                          aria-label="Video link"
                          value={field.value}
                          maxLength={2000}
                          placeholder="YouTube or Vimeo video URL"
                          onInput={(s) => field.setValue(s, sql`target_value`)}
                        />
                      </FormControl>
                      <Typography level="body-sm" className="text-secondary">
                        Use a YouTube or Vimeo link with embedded playback
                        enabled. Saving publishes a new version in this
                        language.
                      </Typography>
                      <Show
                        when={sql`fn.video_embed_url(${field.value}) is not null`}
                      >
                        <EmbeddedVideo
                          url={field.value}
                          title={sql.lit`Video preview`}
                          labels={{
                            play: "Preview video",
                            unavailable:
                              "Check that the video plays here before saving. Employees must have permission to watch it on the video service.",
                          }}
                        />
                      </Show>
                    </>
                  )}
                </Form.Field>
                <Form.ErrorAlert />
                <div className="flex gap-2">
                  <Form.SubmitButton>Save video link</Form.SubmitButton>
                  <Button
                    variant="plain"
                    onClick={(s) =>
                      s.setScalar("video_link_form_open", sql.false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Form.Temporary>
          </Form>
        </div>
      </Show>
    </Data>
  );
}

function UploadPublishedFile(
  props: {
    basePath: string;
    spaceId: Sql;
    parentItemId?: Sql;
    itemId?: Sql;
    contentType?: Sql;
    language: string;
    label: string | Sql;
  },
) {
  return (
    <DriveFileUploadButton
      spaceId={props.spaceId}
      parentItemId={props.parentItemId}
      accept={props.contentType ??
        sql.lit`.pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.ogv,.mov`}
      uploadEndpoint={props.itemId
        ? sql`'/api/files/items/' || ${props.itemId}::string || '/published/' ||
          ${sql.lit(props.language)} || '/upload'`
        : undefined}
      fileHref={(itemId) =>
        sql`${sql.lit(props.basePath)} || '/' || ${itemId}::string`}
      onUploaded={props.itemId ? (s) => s.refetch() : undefined}
    >
      {props.label}
    </DriveFileUploadButton>
  );
}

/** Manager workspace for translated PDFs/videos and language-independent images. */
export function PublishedFilesWorkspace(props: PublishedFilesProps) {
  return (
    <Data
      queryParams={{
        folder: { type: "BigInt", default: sql`cast(null as bigint)` },
      }}
      procedure={(s) => {
        s.defScalar(
          "published_files_space_id",
          sql`(select id from db.file_spaces where space_type = ${
            sql.lit(props.type.name)
          } limit 1)`,
        );
        s.defScalar(
          "can_manage_published_files",
          sql`case when published_files_space_id is null then ${
            props.files.canCreateSpaceSql(props.type, sql`current_user`)
          } else ${
            props.files.accessSql(
              props.type,
              sql`published_files_space_id`,
              sql`current_user`,
              "write",
            )
          } end`,
        );
      }}
    >
      <Show
        when={sql`can_manage_published_files`}
        fallback={
          <Alert color="warning">
            You do not have access to this workspace.
          </Alert>
        }
      >
        <div className="space-y-4 p-4 sm:p-6">
          <div>
            <Typography level="h3">Company files</Typography>
            <Typography level="body-sm" className="text-secondary">
              Upload videos, PDFs, and images for training. Videos and PDFs
              start in English; open a file to add Spanish. Images are shared
              across languages. Uploads are ready immediately.
              {supportsVideoLinks(props.type) &&
                " You can also add YouTube and Vimeo videos by link."}
            </Typography>
          </div>
          <Show
            when={sql`published_files_space_id is null`}
            fallback={
              <DriveWorkspace
                files={props.files}
                type={props.type}
                spaceId={sql`published_files_space_id`}
                title={null}
                initialFolderId={sql`folder`}
                folderQueryParam="folder"
                allowUploads={false}
                fileHref={(itemId) =>
                  sql`${sql.lit(props.basePath)} || '/' || ${itemId}::string`}
                createFile={({ spaceId, parentItemId }) => (
                  <div className="flex flex-wrap items-start gap-2">
                    <UploadPublishedFile
                      basePath={props.basePath}
                      spaceId={spaceId}
                      parentItemId={parentItemId}
                      language={props.control.opts.defaultLanguage}
                      label="Upload file"
                    />
                    {supportsVideoLinks(props.type) && (
                      <VideoLinkForm
                        spaceId={spaceId}
                        parentItemId={parentItemId}
                        language={props.control.opts.defaultLanguage}
                        basePath={props.basePath}
                        label="Add video link"
                      />
                    )}
                  </div>
                )}
              />
            }
          >
            <ActionButton
              action={(s) => {
                s.startTransaction();
                s.if(
                  sql`not exists(select 1 from db.file_spaces where space_type = ${
                    sql.lit(props.type.name)
                  })`,
                  (s) =>
                    props.files.createSpace(s, {
                      type: props.type,
                      name: sql.lit("Company files"),
                      sysUserId: sql`current_user`,
                    }),
                );
                s.commitTransaction();
              }}
            >
              Create workspace
            </ActionButton>
          </Show>
        </div>
      </Show>
    </Data>
  );
}

/** Immediate-upload language variants without the policy approval interface. */
export function PublishedFilePage(
  props: PublishedFilesProps & { itemId: Sql },
) {
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "published_file",
          sql`select item.id, item.name, item.file_space_id, version.content_type
        from db.file_items item join db.file_versions version on version.id = item.current_file_version_id
        where item.id = ${props.itemId} and item.trashed_at is null
          and ${
            props.files.accessSql(
              props.type,
              sql`item.file_space_id`,
              sql`current_user`,
              "write",
            )
          }`,
        );
      }}
    >
      <div className="space-y-4 p-4 sm:p-6">
        <Button href={props.basePath} variant="plain" startIcon="ArrowBack">
          Company files
        </Button>
        <Show
          when={sql`published_file.id is not null`}
          fallback={<Alert color="warning">This file is unavailable.</Alert>}
        >
          <Typography level="h3">{sql`published_file.name`}</Typography>
          <Show
            when={sql`lower(published_file.content_type) like 'image/%'`}
            fallback={
              <div className="space-y-6">
                {props.control.opts.languages.map((language) => (
                  <PublishedFileVariant
                    {...props}
                    language={language.code}
                    label={language.name}
                  />
                ))}
              </div>
            }
          >
            <PublishedFileVariant
              {...props}
              language={props.control.opts.defaultLanguage}
              label="Image — shared across languages"
              image
            />
          </Show>
        </Show>
      </div>
    </Data>
  );
}

function PublishedFileVariant(
  props: PublishedFilesProps & {
    itemId: Sql;
    language: string;
    label: string;
    image?: boolean;
  },
) {
  return (
    <Data
      procedure={(s) =>
        s.defScalar(
          "published_file_version_id",
          sql`(select revision.file_version_id
      from db.controlled_file_language_variants variant
      join db.controlled_file_revisions revision on revision.id = variant.current_controlled_file_revision_id
      where variant.file_item_id = ${props.itemId} and variant.language = ${
            sql.lit(props.language)
          } and revision.status = 'published')`,
        )}
    >
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Typography level="title-lg">{props.label}</Typography>
          <UploadPublishedFile
            basePath={props.basePath}
            itemId={props.itemId}
            language={props.language}
            contentType={supportsVideoLinks(props.type)
              ? sql`case when ${isVideoSource(sql`published_file.content_type`)}
                then '.mp4,.webm,.ogv,.mov' else published_file.content_type end`
              : sql`published_file.content_type`}
            spaceId={sql`published_file.file_space_id`}
            label={props.image
              ? "Upload replacement image"
              : sql`'Upload ' || ${sql.lit(props.label)} || case
                when ${isVideoSource(sql`published_file.content_type`)}
                then ' video' else ' PDF' end`}
          />
        </div>
        {supportsVideoLinks(props.type) && (
          <Show when={isVideoSource(sql`published_file.content_type`)}>
            <VideoLinkForm
              spaceId={sql`published_file.file_space_id`}
              itemId={props.itemId}
              language={props.language}
              label={`Use ${props.label} video link`}
              basePath={props.basePath}
              initialUrl={sql`coalesce((select url from db.external_link_file_versions where file_version_id = published_file_version_id), '')`}
            />
          </Show>
        )}
        <Show
          when={sql`published_file_version_id is not null`}
          fallback={
            <Typography level="body-sm" className="text-secondary">
              No version in this language. Training uses English until a
              translation is added.
            </Typography>
          }
        >
          <FileViewer
            files={props.files}
            fileItemId={props.itemId}
            fileVersionId={sql`published_file_version_id`}
            readOnly
            presentation="governed"
            spaceType={props.type}
          />
        </Show>
      </section>
    </Data>
  );
}
