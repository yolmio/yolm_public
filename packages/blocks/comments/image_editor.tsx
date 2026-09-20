import { Button } from "components/button";
import { RichTextSimpleEditor } from "components/lexical/components/lexical_editor";
import type { MentionsConfig } from "components/lexical/components/lexical_editor";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import { Show, useUniqueId } from "std/ui";

export function CommentImageEditor(props: {
  id: Sql | string;
  scalar: string;
  pendingScalar: string;
  mentions: MentionsConfig;
}) {
  const handle = useUniqueId();
  const inputId = useUniqueId();
  return (
    <Data
      local
      noRefetch
      procedure={(s) => {
        s.defScalar("comment_image_pending", 0);
        s.defScalar("comment_image_failed", 0);
        s.defScalar("comment_image_error", sql.lit``);
        s.defScalar("comment_image_result", sql`cast(null as json)`);
      }}
    >
      <RichTextSimpleEditor
        id={props.id}
        editorHandle={handle}
        value={sql.ref(props.scalar)}
        onChange={(s, value) => s.setScalar(props.scalar, value)}
        onChangeDebounceMs={0}
        mentions={props.mentions}
        sx={{ minHeight: "80px" }}
        imageUploadInputId={inputId}
        onImageUploadStateChange={(s, state) => {
          s.setScalar(
            "comment_image_pending",
            sql`cast(${state}->>'pending' as int)`,
          );
          s.setScalar(
            "comment_image_failed",
            sql`cast(${state}->>'failed' as int)`,
          );
          s.setScalar("comment_image_error", sql`${state}->>'error'`);
          s.setScalar(
            props.pendingScalar,
            sql`comment_image_pending > 0 or comment_image_failed > 0`,
          );
        }}
      />
      <input
        id={inputId}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onFileChange={(s) => {
          s.defRecord("comment_dom_image", sql`select * from file limit 1`);
          s.jsCall({
            module: "lexical_editor",
            exportName: "getPendingImageUpload",
            handle,
            argJson: sql`json_build_object('handle', ${handle})`,
            resultJsonScalar: "comment_upload_request",
          });
          s.setScalar("comment_image_result", sql`cast(null as json)`);
          s.tryServer({
            transferFiles: sql`select uuid from file`,
            body: (s) => {
              s.throwErrorIf(
                sql`current_user is null`,
                sql.lit`Sign in to attach images.`,
              );
              s.throwErrorIf(
                sql`comment_dom_image.size > 10485760 or comment_dom_image.size = 0`,
                sql.lit`Images must be between 1 byte and 10 MB.`,
              );
              s.readDomFile(sql`comment_dom_image.uuid`, "comment_image_bytes");
              s.throwErrorIf(
                sql`octet_length(comment_image_bytes) > 10485760 or octet_length(comment_image_bytes) = 0`,
                sql.lit`Images must be between 1 byte and 10 MB.`,
              );
              s.defScalar(
                "comment_image_signature",
                sql`left(bytes.to_hex(comment_image_bytes), 24)`,
              );
              s.throwErrorIf(
                sql`not (
                (comment_dom_image.type = 'image/png' and comment_image_signature like '89504e470d0a1a0a%') or
                (comment_dom_image.type = 'image/jpeg' and comment_image_signature like 'ffd8ff%') or
                (comment_dom_image.type = 'image/gif' and (comment_image_signature like '474946383761%' or comment_image_signature like '474946383961%')) or
                (comment_dom_image.type = 'image/webp' and comment_image_signature like '52494646________57454250')
              )`,
                sql.lit`The file is not a supported image.`,
              );
              s.createBlob(sql`comment_image_bytes`, {
                defHashScalar: "uploaded_comment_image_hash",
              });
              s.startTransaction();
              s.modify(
                sql`update db.comment_images set created_at = now()
                where public_id = cast(comment_upload_request->>'id' as uuid)
                  and uploaded_by_user_id = current_user and comment_id is null
                  and blob_hash = uploaded_comment_image_hash`,
              );
              s.modify(
                sql`insert into db.comment_images(public_id, uploaded_by_user_id, blob_hash, content_type)
                values (cast(comment_upload_request->>'id' as uuid), current_user, uploaded_comment_image_hash, comment_dom_image.type)
                on conflict (public_id) do nothing`,
              );
              s.setScalar(
                "ui.comment_image_result",
                sql`json_build_object(
                'id', comment_upload_request->>'id',
                'src', '/api/comment-images/' || (comment_upload_request->>'id'),
                'blobHash', bytes.to_hex(uploaded_comment_image_hash),
                'contentType', comment_dom_image.type
              )`,
              );
              s.commitTransaction();
            },
            catch: (s) =>
              s.setScalar(
                "comment_image_result",
                sql`json_build_object('id', comment_upload_request->>'id', 'error', 'Image upload failed. Retry, or remove this image and attach a PNG, JPEG, GIF, or WebP file under 10 MB.')`,
              ),
          });
          s.jsCall({
            module: "lexical_editor",
            exportName: "executeCommand",
            handle,
            argJson:
              sql`json_build_object('handle', ${handle}, 'command', 'completeImageUpload') || comment_image_result`,
          });
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          variant="plain"
          startIcon="AddPhotoAlternate"
          onClick={(s) =>
            s.jsCall({
              module: "lexical_editor",
              exportName: "executeCommand",
              handle,
              argJson:
                sql`json_build_object('handle', ${handle}, 'command', 'insertImageFromFile')`,
            })}
        >
          Attach image
        </Button>
        <Show when={sql`comment_image_pending > 0`}>
          <span role="status" className="text-xs text-secondary">
            Uploading {sql`comment_image_pending`} image(s)…
          </span>
        </Show>
      </div>
      <Show when={sql`comment_image_failed > 0`}>
        <div
          role="alert"
          className="mt-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm"
        >
          <p>{sql`comment_image_error`}</p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="xs"
              variant="outlined"
              onClick={(s) =>
                s.jsCall({
                  module: "lexical_editor",
                  exportName: "executeCommand",
                  handle,
                  argJson:
                    sql`json_build_object('handle', ${handle}, 'command', 'retryImageUploads')`,
                })}
            >
              Retry images
            </Button>
            <Button
              type="button"
              size="xs"
              variant="plain"
              color="neutral"
              onClick={(s) =>
                s.jsCall({
                  module: "lexical_editor",
                  exportName: "executeCommand",
                  handle,
                  argJson:
                    sql`json_build_object('handle', ${handle}, 'command', 'removeFailedImages')`,
                })}
            >
              Remove failed images
            </Button>
          </div>
        </div>
      </Show>
    </Data>
  );
}
