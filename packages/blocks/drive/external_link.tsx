import { Button } from "components/button";
import { Input } from "components/input";
import { Typography } from "components/typography";
import {
  EmbeddedVideo,
  ensureVideoEmbedFunction,
} from "components/embedded_video";
import { isPlayableVideoMime } from "components/video_player";
import { ActionButton } from "std/action_button";
import { Data } from "std/data";
import { sql } from "std/sql_utils";
import type { AnyExpr, Sql } from "std/sql_utils";
import type { ServerStatementsBase } from "std/statements";
import { system } from "std/system";
import { Show } from "std/ui";
import type {
  DriveBlockContract,
  DriveExtension,
  FileVersionCreatedEvent,
  FileViewerContribution,
} from "./types.ts";

export const externalLinkContentType = "application/vnd.yolm.external-link";
export const videoLinkContentType = "application/vnd.yolm.video-link";

/** Both uploaded videos and provider links belong to the same video item. */
export function isVideoSource(contentType: Sql): Sql {
  return sql`(${isPlayableVideoMime(contentType)}
    or ${contentType} = ${sql.lit(videoLinkContentType)})`;
}

export interface ExternalLinkViewerProps {
  links: ExternalLinkExtension;
  fileItemId: AnyExpr;
  fileVersionId: AnyExpr;
  readOnly: AnyExpr;
}

const ipv4Octet = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const ipv4Address = `${ipv4Octet}(?:\\.${ipv4Octet}){3}`;
const dnsLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const dnsFinalLabel = "[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?";
const dnsHost = `(?:${dnsLabel}|(?:${dnsLabel}\\.)+${dnsFinalLabel})\\.?`;
const ipv6HexGroup = "[0-9a-f]{1,4}";
const ipv6WithIpv4Addresses = [
  `(?:${ipv6HexGroup}:){6}${ipv4Address}`,
];
for (let leftGroups = 0; leftGroups <= 5; leftGroups++) {
  const left = leftGroups === 0
    ? ""
    : `${ipv6HexGroup}(?::${ipv6HexGroup}){${leftGroups - 1}}`;
  for (let rightGroups = 0; rightGroups <= 5 - leftGroups; rightGroups++) {
    const right = rightGroups === 0
      ? ""
      : `(?:${ipv6HexGroup}:){${rightGroups}}`;
    ipv6WithIpv4Addresses.push(`${left}::${right}${ipv4Address}`);
  }
}
const ipv6Address = [
  "(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}",
  "(?:[0-9a-f]{1,4}:){1,7}:",
  "(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}",
  "(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}",
  "(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}",
  "(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}",
  "(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}",
  "[0-9a-f]{1,4}:(?:(?::[0-9a-f]{1,4}){1,6})",
  ":(?:(?::[0-9a-f]{1,4}){1,7}|:)",
  ...ipv6WithIpv4Addresses,
].join("|");
const externalLinkUrlPattern =
  `(?i)^https://(?:${ipv4Address}|${dnsHost}|\\[(?:${ipv6Address})\\])(?::[0-9]{1,5})?(?:[/?#][^\\x00-\\x20\\x7f-\\x9f\\\\]*)?$`;
const externalLinkPortPattern =
  "(?i)^https://(?:\\[[^\\]]+\\]|[^:/?#]+):([0-9]{1,5})(?:[/?#]|$)";
const externalLinkDnsHostPattern =
  `(?i)^https://(${dnsHost})(?::[0-9]{1,5})?(?:[/?#]|$)`;

function invalidExternalLinkUrl(url: Sql) {
  return sql`
    nullif(trim(${url}), '') is null
    or ${url} <> trim(${url})
    or not regex.is_match(
      ${url},
      ${sql.lit(externalLinkUrlPattern)}
    )
    or length(
      regex.replace(
        coalesce(
          regex.capture(
            ${url},
            ${sql.lit(externalLinkDnsHostPattern)},
            1
          ),
          ''
        ),
        '\\.$',
        ''
      )
    ) > 253
    or coalesce(
      try_cast(
        regex.capture(${url}, ${sql.lit(externalLinkPortPattern)}, 1)
        as int
      ),
      0
    ) > 65535
  `;
}

/**
 * Optional URL-backed representation for Drive files. Each URL change creates
 * an immutable technical version; lifecycle and publication behavior remains
 * owned by whichever Drive lifecycle is composed with this extension.
 */
export class ExternalLinkExtension implements DriveExtension {
  readonly name = "external_link";
  readonly contentTable = "external_link_file_versions";
  #files?: DriveBlockContract;

  constructor(readonly opts: { videoSpaceTypes?: readonly string[] } = {}) {}

  supportsVideoSpace(typeName: string) {
    return this.opts.videoSpaceTypes?.includes(typeName) ?? false;
  }

  private videoSpaceSql(spaceId: Sql): Sql {
    const types = this.opts.videoSpaceTypes ?? [];
    return types.length
      ? sql`exists (select 1 from db.file_spaces video_space
          where video_space.id = ${spaceId}
            and ${
        sql.inList(
          sql`video_space.space_type`,
          types.map((type) => sql.lit(type)),
        )
      })`
      : sql.false;
  }

  canChangeVersionContentType = (spaceId: Sql, previous: Sql, next: Sql) =>
    sql`${this.videoSpaceSql(spaceId)}
      and ${isVideoSource(previous)} and ${isVideoSource(next)}`;

  readonly viewer: FileViewerContribution = {
    name: "external_link",
    canView: (version) =>
      sql`${version}.content_type in (${sql.lit(externalLinkContentType)}, ${
        sql.lit(videoLinkContentType)
      })`,
    render: (props) => (
      <ExternalLinkViewer
        links={this}
        fileItemId={props.fileItemId}
        fileVersionId={props.fileVersionId}
        readOnly={props.readOnly}
      />
    ),
  };

  initialize(files: DriveBlockContract) {
    this.#files = files;
    ensureVideoEmbedFunction();
    system.db.table(this.contentTable, (table) => {
      table.fk("file_version_id", files.versionTable).notNull().unique()
        .onDelete("Cascade");
      table.string("url", 2000).notNull();
      table.skipAutoApi();
    });
  }

  validate(files: DriveBlockContract) {
    for (const name of this.opts.videoSpaceTypes ?? []) {
      if (
        !files.spaceTypes.some((type) =>
          type.name === name && type.extensions.includes(this)
        )
      ) {
        throw new Error(
          `Video space "${name}" must install ExternalLinkExtension.`,
        );
      }
    }
  }

  writeVersionContent = (
    s: ServerStatementsBase<any>,
    event: FileVersionCreatedEvent,
  ) => {
    const url = event.externalUrl ?? sql.null;
    s.if(
      sql`${event.contentType} in (${sql.lit(externalLinkContentType)}, ${
        sql.lit(videoLinkContentType)
      })`,
      (s) => {
        s.throwErrorUnless(
          sql`${event.byteLength} = 0 and not (${invalidExternalLinkUrl(url)})`,
          sql.lit`Enter a valid HTTPS URL.`,
        );
        s.if(
          sql`${event.contentType} = ${sql.lit(videoLinkContentType)}
            or ${this.videoSpaceSql(event.spaceId)}`,
          (s) =>
            s.throwErrorUnless(
              sql`${event.contentType} = ${sql.lit(videoLinkContentType)}
              and ${this.videoSpaceSql(event.spaceId)}
              and fn.video_embed_url(${url}) is not null`,
              sql.lit`Enter a supported YouTube or Vimeo video link.`,
            ),
        );
        s.modify(
          sql`insert into db.external_link_file_versions (file_version_id, url)
          values (${event.versionId}, trim(${url}))`,
        );
      },
    );
  };

  registerStoredProcedures = () => {
    if (this.opts.videoSpaceTypes?.length) {
      system.storedProcedure({
        name: "external_video_save",
        transaction: "caller",
        inputScalars: [
          { name: "p_item_id", type: "BigInt" },
          { name: "p_space_id", type: "BigInt" },
          { name: "p_parent_id", type: "BigInt" },
          { name: "p_name", type: { type: "String", maxLength: 500 } },
          { name: "p_url", type: { type: "String", maxLength: 2000 } },
          { name: "p_language", type: { type: "String", maxLength: 20 } },
          { name: "p_user_id", type: "BigInt" },
        ],
        outputScalars: [{ name: "item_id", type: "BigInt" }],
        procedure: (s) => {
          s.throwErrorUnless(
            sql`${this.videoSpaceSql(sql`p_space_id`)}
              and coalesce(${
              this.#requiredFiles().runtimeAccessSql(
                sql`p_space_id`,
                sql`p_user_id`,
                "write",
              )
            }, false)`,
            sql.lit`You cannot add videos to this workspace.`,
          );
          s.throwErrorUnless(
            sql`fn.video_embed_url(p_url) is not null`,
            sql.lit`Enter a supported YouTube or Vimeo video link.`,
          );
          s.if(sql`p_item_id is null`, (s) =>
            this.createLink(s, {
              spaceId: sql`p_space_id`,
              parentItemId: sql`p_parent_id`,
              name: sql`p_name`,
              url: sql`trim(p_url)`,
              sysUserId: sql`p_user_id`,
              language: sql`p_language`,
              intoItem: "item_id",
            })).else((s) => {
              s.throwErrorUnless(
                sql`exists (select 1 from db.file_items
                  where id = p_item_id and file_space_id = p_space_id)`,
                sql.lit`This video is unavailable.`,
              );
              this.saveLink(s, {
                fileItemId: sql`p_item_id`,
                url: sql`trim(p_url)`,
                sysUserId: sql`p_user_id`,
                language: sql`p_language`,
              });
              s.setScalar("item_id", sql`p_item_id`);
            });
        },
      });
    }
    system.storedProcedure({
      name: "external_link_save",
      transaction: "standalone",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_url", type: { type: "String", maxLength: 2000 } },
      ],
      procedure: (s) => {
        s.startTransaction();
        this.saveLink(s, {
          fileItemId: sql`p_file_item_id`,
          url: sql`p_url`,
          sysUserId: sql`current_user`,
        });
        s.commitTransaction();
      },
    });
  };

  createLink<T extends ServerStatementsBase<any>>(
    s: T,
    opts: {
      spaceId: Sql;
      parentItemId?: Sql;
      name: Sql;
      description?: Sql;
      url: Sql;
      sysUserId: Sql;
      intoItem?: string;
      intoVersion?: string;
      language?: Sql;
    },
  ) {
    const files = this.#requiredFiles();
    const parentItemId = opts.parentItemId ?? sql`cast(null as bigint)`;
    s.if(
      sql`not (${
        files.canCreateFileSql({
          spaceId: opts.spaceId,
          parentItemId,
          sysUserId: opts.sysUserId,
        })
      })`,
      (s) => s.throwError(sql.lit`You cannot create links in this space.`),
    );
    s.if(
      sql`not (${files.extensionEnabledSql(opts.spaceId, this.name)})`,
      (s) =>
        s.throwError(
          sql.lit`External links are not enabled for this space.`,
        ),
    );
    s.if(
      invalidExternalLinkUrl(opts.url),
      (s) => s.throwError(sql.lit`Enter a valid HTTPS URL.`),
    );
    const itemResult = opts.intoItem ?? "created_external_link_item_id";
    const versionResult = opts.intoVersion ??
      "created_external_link_version_id";
    files.createFileItem(s, {
      spaceId: opts.spaceId,
      parentItemId: opts.parentItemId,
      name: opts.name,
      description: opts.description,
      into: itemResult,
    });
    files.createFileVersion(s, {
      itemId: sql.ref(itemResult),
      fileName: opts.name,
      contentType: sql`case when ${this.videoSpaceSql(opts.spaceId)}
        then ${sql.lit(videoLinkContentType)} else ${
        sql.lit(externalLinkContentType)
      } end`,
      byteLength: sql`0`,
      sysUserId: opts.sysUserId,
      intoVersion: versionResult,
      externalUrl: opts.url,
      language: opts.language,
    });
  }

  saveLink<T extends ServerStatementsBase<any>>(
    s: T,
    opts: {
      fileItemId: Sql;
      url: Sql;
      sysUserId: Sql;
      note?: Sql;
      intoVersion?: string;
      language?: Sql;
    },
  ) {
    const files = this.#requiredFiles();
    s.if(
      invalidExternalLinkUrl(opts.url),
      (s) => s.throwError(sql.lit`Enter a valid HTTPS URL.`),
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.file_items item
          join db.file_versions version
            on version.id = item.current_file_version_id
          where item.id = ${opts.fileItemId}
            and item.item_kind = 'file'
            and item.trashed_at is null
            and (version.content_type = ${sql.lit(externalLinkContentType)}
              or (${this.videoSpaceSql(sql`item.file_space_id`)} and ${
        isVideoSource(sql`version.content_type`)
      }))
            and ${
        files.extensionEnabledSql(
          sql`item.file_space_id`,
          this.name,
        )
      }
        )
      `,
      (s) => s.throwError(sql.lit`This external link is unavailable.`),
    );
    s.if(
      sql`
        not (${
        files.canCreateVersionSql({
          spaceId:
            sql`(select file_space_id from db.file_items where id = ${opts.fileItemId})`,
          itemId: opts.fileItemId,
          sysUserId: opts.sysUserId,
        })
      })
      `,
      (s) => s.throwError(sql.lit`You cannot edit this external link.`),
    );
    const versionResult = opts.intoVersion ?? "saved_external_link_version_id";
    files.createFileVersion(s, {
      itemId: opts.fileItemId,
      fileName:
        sql`(select name from db.file_items where id = ${opts.fileItemId})`,
      contentType: sql`case when ${
        this.videoSpaceSql(
          sql`(select file_space_id from db.file_items where id = ${opts.fileItemId})`,
        )
      }
        then ${sql.lit(videoLinkContentType)} else ${
        sql.lit(externalLinkContentType)
      } end`,
      byteLength: sql`0`,
      note: opts.note,
      sysUserId: opts.sysUserId,
      intoVersion: versionResult,
      externalUrl: opts.url,
      language: opts.language,
    });
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error("ExternalLinkExtension is not attached to DriveBlock.");
    }
    return this.#files;
  }
}

export function ExternalLinkViewer(props: ExternalLinkViewerProps) {
  return (
    <Data
      procedure={(s) => {
        s.defRecord(
          "external_link_document",
          sql`
            select
              item.id as file_item_id,
              item.name,
              version.content_type,
              link.url
            from db.file_items item
            join db.file_versions version
              on version.file_item_id = item.id
              and version.id = ${props.fileVersionId}
            join db.external_link_file_versions link
              on link.file_version_id = version.id
            where item.id = ${props.fileItemId}
          `,
        );
      }}
    >
      <Show when={sql`external_link_document.file_item_id is not null`}>
        <section className="space-y-4 rounded-lg border border-divider bg-surface p-5">
          <div>
            <Typography level="title-lg">
              {sql`external_link_document.name`}
            </Typography>
            <Typography level="body-sm" className="mt-1 text-secondary">
              {sql`external_link_document.url`}
            </Typography>
          </div>
          <Show
            when={sql`external_link_document.content_type = ${
              sql.lit(videoLinkContentType)
            }`}
            fallback={
              <Button
                component="a"
                href={sql`external_link_document.url`}
                target="_blank"
                startIcon="OpenInNew"
              >
                Open link
              </Button>
            }
          >
            <EmbeddedVideo
              url={sql`external_link_document.url`}
              title={sql`external_link_document.name`}
            />
          </Show>
          <Show
            when={sql`not (${props.readOnly}) and external_link_document.content_type <> ${
              sql.lit(videoLinkContentType)
            }`}
          >
            <Data
              local
              procedure={(s) => {
                s.defScalar(
                  "external_link_edit_url",
                  sql`external_link_document.url`,
                );
              }}
            >
              <div className="flex flex-col gap-2 border-t border-divider pt-4 sm:flex-row">
                <Input
                  bindScalar="external_link_edit_url"
                  placeholder="https://..."
                  fullWidth
                />
                <ActionButton
                  action={(s) => {
                    s.callStoredProcedure("external_link_save", {
                      inputScalars: {
                        p_file_item_id:
                          sql`external_link_document.file_item_id`,
                        p_url: sql`ui.external_link_edit_url`,
                      },
                    });
                  }}
                  successMessage="External link updated"
                  startIcon="Save"
                >
                  Save new version
                </ActionButton>
              </div>
            </Data>
          </Show>
        </section>
      </Show>
    </Data>
  );
}
