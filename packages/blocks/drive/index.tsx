import { applySignedTransferIdentity } from "blocks/auth/signed_transfer";
import { AuthBlock } from "blocks/auth";
import { fileTypeIconKindSql } from "components/file_type_icon";
import { sql } from "std/sql_utils";
import type { NumericExpr, Sql } from "std/sql_utils";
import type {
  EndpointStatements,
  ServerStatementsBase,
  StatementsBase,
} from "std/statements";
import { system } from "std/system";
import type { Block } from "std/system";
import { useApp } from "std/ui";
import type {
  CreateFileItemOpts,
  CreateFileVersionOpts,
  CreateFolderOpts,
  CreateSpaceOpts,
  DriveAccessVerb,
  DriveApiRegistration,
  DriveBlockContract,
  DriveBlockOpts,
  DriveExtension,
  DriveGrantConfig,
  DriveSpaceType,
  EnsureBoundSpaceOpts,
  FileAccessLevel,
  FileCreateAccessContext,
  FileItemUpdateAccessContext,
  FileVersionAccessContext,
  FileVersionCreateAccessContext,
  FileVersionCreatedEvent,
  MoveFileItemOpts,
  RegisteredFileViewer,
  UpdateFileItemMetadataOpts,
} from "./types";
import { fileItemSubtreeIds } from "./hierarchy";

export type {
  CreateFileItemOpts,
  CreateFileVersionOpts,
  CreateFolderOpts,
  CreateSpaceOpts,
  DriveAccessVerb,
  DriveApiRegistration,
  DriveBlockContract,
  DriveBlockOpts,
  DriveExtension,
  DriveGrantConfig,
  DriveItemOrdering,
  DriveLifecycle,
  DriveSpaceAccess,
  DriveSpaceType,
  EnsureBoundSpaceOpts,
  FileAccessLevel,
  FileCreateAccessContext,
  FileItemUpdateAccessContext,
  FileVersionAccessContext,
  FileVersionCreateAccessContext,
  FileVersionCreatedEvent,
  FileViewerContribution,
  FileViewerDocumentHref,
  MoveFileItemOpts,
  RegisteredFileViewer,
  UpdateFileItemMetadataOpts,
} from "./types";
export { DriveFileUploadButton, DriveWorkspace } from "./workspace";
export type {
  DriveFileUploadButtonProps,
  DriveWorkspaceProps,
} from "./workspace";
export { FileSpacePermissionsPanel } from "./permissions";
export type { FileSpacePermissionsPanelProps } from "./permissions.tsx";
export { FileViewer } from "./viewer";
export type { FileViewerProps } from "./viewer.tsx";
export {
  DRIVE_VIEWER_WORKSPACE_HANDLE,
  DriveViewerNavigation,
  DriveViewerWorkspace,
} from "./viewer_workspace";
export type {
  DriveViewerNavigationFile,
  DriveViewerNavigationProps,
  DriveViewerWorkspaceProps,
} from "./viewer_workspace.tsx";
export {
  ArchiveViewerExtension,
  DocxViewerExtension,
  ImageViewerExtension,
  OutlookMessageViewerExtension,
  P7mViewerExtension,
  SpreadsheetViewerExtension,
  TiffViewerExtension,
} from "./preview";
export type { DrivePreviewExtensionOpts } from "./preview.tsx";
export { CadViewerExtension } from "./cad_viewer";
export type { CadViewerExtensionOptions } from "./cad_viewer.tsx";
export {
  ControlledFileLibrary,
  PublishedControlledFile,
} from "./controlled_library";
export {
  ControlledFilePanel,
  ControlledFileWorkspace,
} from "./controlled_lifecycle";
export type {
  ControlledFilePanelProps,
  ControlledFileWorkspaceProps,
} from "./controlled_lifecycle.tsx";
export type {
  ControlledFileLibraryProps,
  PublishedControlledFileProps,
} from "./controlled_library.tsx";
export {
  CreateMarkdownDocumentButton,
  markdownDocumentContentType,
  MarkdownDocumentEditor,
  MarkdownDocumentExtension,
} from "./markdown_document";
export type { MarkdownDocumentEditorProps } from "./markdown_document.tsx";
export { DriveDerivations } from "./derivations.tsx";
export type {
  DriveDerivationDefinition,
  DriveDerivationRequestContext,
  DriveDerivedArtifactDefinition,
  InstalledDriveDerivedArtifact,
} from "./derivations.tsx";
export {
  cadPreparationDefinitions,
  dstvDuckDbArtifact,
  dstvViewerGlbArtifact,
  dstvViewerSceneArtifact,
  dwgDuckDbArtifact,
  dwgViewerGlbArtifact,
  dwgViewerSceneArtifact,
  dxfDuckDbArtifact,
  dxfViewerSceneArtifact,
  ifcDuckDbArtifact,
  ifcViewerGlbArtifact,
  solidworksDuckDbArtifact,
  solidworksViewerGlbArtifact,
  stepDuckDbArtifact,
  stepViewerGlbArtifact,
} from "./cad_artifacts.ts";
export type { CadArtifactReference, FabCadFormat } from "./cad_artifacts.ts";
const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const accessRanks: Record<FileAccessLevel, number> = {
  viewer: 1,
  editor: 2,
  manager: 3,
};

function grantConfig(
  grants: Partial<DriveGrantConfig> | undefined,
): DriveGrantConfig {
  return {
    users: grants?.users ?? false,
    permissions: grants?.permissions ?? false,
  };
}

/** True when the current space is owned by the supplied user. */
export function driveSpaceOwner(spaceRecord: Sql, sysUserId: Sql) {
  return sql`${spaceRecord}.owner_user_id = ${sysUserId}`;
}

/**
 * Direct user or Auth-permission grant at the requested minimum level.
 * Space types must opt into the corresponding grant UI and compose this
 * predicate explicitly in their access callbacks.
 */
export function driveGrantAccess(
  spaceRecord: Sql,
  sysUserId: Sql,
  minimum: FileAccessLevel,
) {
  return sql`(
    ${driveUserGrantAccess(spaceRecord, sysUserId, minimum)}
    or ${drivePermissionGrantAccess(spaceRecord, sysUserId, minimum)}
  )`;
}

export interface DriveEndpointsProps {
  files: DriveBlock;
  /** Session cookie holding the auth token. Defaults to `y-t`. */
  cookieName?: Sql;
}

/** Direct user grant at the requested minimum level. */
export function driveUserGrantAccess(
  spaceRecord: Sql,
  sysUserId: Sql,
  minimum: FileAccessLevel,
) {
  const minimumRank = accessRanks[minimum];
  return sql`
    exists (
      select 1
      from db.file_space_user_grants user_grant
      where user_grant.file_space_id = ${spaceRecord}.id
        and user_grant.sys_user_id = ${sysUserId}
        and case user_grant.access_level
          when 'manager' then 3
          when 'editor' then 2
          else 1
        end >= ${minimumRank}
    )
  `;
}

/** Auth-permission grant at the requested minimum level. */
export function drivePermissionGrantAccess(
  spaceRecord: Sql,
  sysUserId: Sql,
  minimum: FileAccessLevel,
) {
  const minimumRank = accessRanks[minimum];
  return sql`
    exists (
      select 1
      from db.file_space_permission_grants permission_grant
      where permission_grant.file_space_id = ${spaceRecord}.id
        and ${
    AuthBlock.userHasPermission(
      sql`permission_grant.permission`,
      sysUserId as NumericExpr,
    )
  }
        and case permission_grant.access_level
          when 'manager' then 3
          when 'editor' then 2
          else 1
        end >= ${minimumRank}
    )
  `;
}

function validateStableName(value: string, label: string) {
  if (
    !value || value !== value.trim() ||
    !/^[a-z][a-z0-9_]*$/.test(value)
  ) {
    throw new Error(
      `DriveBlock ${label} must be a normalized snake_case name.`,
    );
  }
}

function spaceTypeExtensions(type: DriveSpaceType): readonly DriveExtension[] {
  return type.lifecycle
    ? [type.lifecycle, ...type.extensions]
    : type.extensions;
}

/**
 * One reusable file system for global drives and record-scoped workspaces.
 *
 * Drive owns identity, folders, immutable technical versions, tags, trash,
 * standalone grants, and byte delivery. Format and workflow behavior belongs
 * to optional extensions.
 */
export class DriveBlock implements Block, DriveBlockContract {
  blockName = "DriveBlock";

  /**
   * Installs authenticated Drive byte endpoints on the app currently being
   * rendered. Include it only in apps that upload or serve blob-backed files.
   */
  static Endpoints(props: DriveEndpointsProps) {
    const app = useApp();
    props.files.#registerAppEndpoints({
      domain: app.domain,
      cookieName: props.cookieName ?? sql.lit`y-t`,
    });
    return [];
  }

  static permissions = [
    {
      name: "can_manage_drive",
      displayName: "Manage Drive",
      description:
        "Create and administer organization-managed file spaces and grants.",
      group: "Drive",
    },
  ];

  readonly spaceTable = "file_spaces";
  readonly itemTable = "file_items";
  readonly versionTable = "file_versions";
  readonly versionBlobTable = "file_version_blobs";
  readonly tagTable = "file_tags";
  readonly tagAssignmentTable = "file_tag_assignments";

  readonly spaceTypes: readonly DriveSpaceType[];
  readonly extensions: readonly DriveExtension[];
  readonly viewers: RegisteredFileViewer[] = [];
  readonly hasUserGrants: boolean;
  readonly hasPermissionGrants: boolean;
  readonly hasOwners: boolean;
  #apiRegistrations = new Map<string, DriveApiRegistration>();

  constructor(readonly opts: DriveBlockOpts) {
    this.spaceTypes = opts.spaceTypes;
    if (this.spaceTypes.length === 0) {
      throw new Error("DriveBlock requires at least one space type.");
    }

    const names = new Set<string>();
    const tables = new Set<string>();
    const extensions = new Map<string, DriveExtension>();
    for (const type of this.spaceTypes) {
      validateStableName(type.name, "space type");
      if (names.has(type.name)) {
        throw new Error(`DriveBlock space type "${type.name}" is duplicated.`);
      }
      names.add(type.name);
      if ((type.tableName === undefined) !== (type.define === undefined)) {
        throw new Error(
          `DriveBlock space type "${type.name}" must provide both tableName and define, or neither.`,
        );
      }
      if (type.tableName) {
        validateStableName(type.tableName, "space binding table");
        if (tables.has(type.tableName)) {
          throw new Error(
            `DriveBlock binding table "${type.tableName}" is duplicated.`,
          );
        }
        tables.add(type.tableName);
      }
      const typeExtensionNames = new Set<string>();
      for (const extension of spaceTypeExtensions(type)) {
        validateStableName(extension.name, "extension name");
        if (typeExtensionNames.has(extension.name)) {
          throw new Error(
            `DriveBlock extension "${extension.name}" is duplicated on space type "${type.name}".`,
          );
        }
        typeExtensionNames.add(extension.name);
        const registered = extensions.get(extension.name);
        if (registered && registered !== extension) {
          throw new Error(
            `DriveBlock extension "${extension.name}" must use the same instance across space types.`,
          );
        }
        extensions.set(extension.name, extension);
        if (extension.viewer) {
          // One registration per extension; each additional space type only
          // extends the type-name list, so large editors are not registered
          // (and later emitted) once per space type.
          const registered = this.viewers.find((viewer) =>
            viewer.extensionName === extension.name
          );
          if (registered) {
            registered.spaceTypeNames.push(type.name);
          } else {
            this.viewers.push({
              ...extension.viewer,
              extensionName: extension.name,
              spaceTypeNames: [type.name],
            });
          }
        }
      }
    }
    this.extensions = [...extensions.values()];
    this.hasUserGrants = this.spaceTypes.some((type) =>
      grantConfig(type.grants).users
    );
    this.hasPermissionGrants = this.spaceTypes.some((type) =>
      grantConfig(type.grants).permissions
    );
    this.hasOwners = this.spaceTypes.some((type) => type.owner);
  }

  itemOrderSql(itemRecord: Sql, customOrdering: Sql): Sql {
    return sql`
      case
        when ${customOrdering}
          then ${itemRecord}.sort_order
        else ordering.new(null, null)
      end,
      ${itemRecord}.name collate nocase,
      ${itemRecord}.id
    `;
  }

  customOrderingSql(spaceId: Sql): Sql {
    const customTypes = this.spaceTypes.filter((type) =>
      type.itemOrdering === "custom"
    );
    if (customTypes.length === 0) return sql`false`;
    return sql`
      exists (
        select 1
        from db.file_spaces ordering_space
        where ordering_space.id = ${spaceId}
          and cast(ordering_space.space_type as string) in (
            ${customTypes.map((type) => sql.lit(type.name))}
          )
      )
    `;
  }

  extensionEnabledSql(spaceId: Sql, extensionName: string): Sql {
    const enabledTypes = this.spaceTypes.filter((type) =>
      spaceTypeExtensions(type).some((extension) =>
        extension.name === extensionName
      )
    );
    if (enabledTypes.length === 0) return sql`false`;
    return sql`
      exists (
        select 1
        from db.file_spaces extension_space
        where extension_space.id = ${spaceId}
          and ${
      this.extensionEnabledForTypeSql(
        sql`extension_space.space_type`,
        extensionName,
      )
    }
      )
    `;
  }

  extensionEnabledForTypeSql(
    spaceType: Sql,
    extensionName: string,
  ): Sql {
    const enabledTypes = this.spaceTypes.filter((type) =>
      spaceTypeExtensions(type).some((extension) =>
        extension.name === extensionName
      )
    );
    if (enabledTypes.length === 0) return sql`false`;
    return sql.inList(
      sql`cast(${spaceType} as string)`,
      enabledTypes.map((type) => sql.lit(type.name)),
    );
  }

  blobUploadsEnabledSql(spaceId: Sql): Sql {
    const enabledTypes = this.spaceTypes.filter((type) =>
      type.blobUploads !== false
    );
    if (enabledTypes.length === 0) return sql`false`;
    return sql`exists (
      select 1
      from db.file_spaces upload_space
      where upload_space.id = ${spaceId}
        and cast(upload_space.space_type as string) in (
          ${enabledTypes.map((type) => sql.lit(type.name))}
        )
    )`;
  }

  canCreateSpaceSql(spaceType: DriveSpaceType, sysUserId: Sql): Sql {
    this.assertSpaceType(spaceType);
    if (spaceType.tableName || !spaceType.canCreate) return sql`false`;
    return spaceType.canCreate(sysUserId);
  }

  initialize() {
    system.enum_({
      name: "drive_space_type",
      values: this.spaceTypes.map((type) => ({
        name: type.name,
        displayName: type.displayName ??
          type.name.split("_").map((part) =>
            part ? part[0].toUpperCase() + part.slice(1) : part
          ).join(" "),
      })),
    });
    system.enum_({
      name: "file_item_kind",
      values: [
        { name: "folder", displayName: "Folder" },
        { name: "file", displayName: "File" },
      ],
    });
    system.enum_({
      name: "file_access_level",
      values: [
        { name: "viewer", displayName: "Viewer" },
        { name: "editor", displayName: "Editor" },
        { name: "manager", displayName: "Manager" },
      ],
    });

    system.db.table(this.spaceTable, (table) => {
      table.enum("space_type", "drive_space_type").notNull();
      table.string("name", 250).notNull();
      table.string("description", 2000).multiline();
      if (this.hasOwners) {
        table.fk("owner_user_id", "sys_users").onDelete("Restrict");
      }
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
      table.skipAutoApi();
    });

    for (const type of this.spaceTypes) {
      if (!type.tableName || !type.define) continue;
      const define = type.define;
      system.db.table(type.tableName, (table) => {
        table.fk("file_space_id", this.spaceTable).notNull().unique().onDelete(
          "Cascade",
        );
        define(table);
        table.skipAutoApi();
      });
    }

    system.db.table(this.itemTable, (table) => {
      table.fk("file_space_id", this.spaceTable).notNull().onDelete("Cascade");
      table.fk("parent_file_item_id", this.itemTable).onDelete("Restrict");
      table.enum("item_kind", "file_item_kind").notNull();
      table.string("name", 500).notNull();
      table.string("description", 2000).multiline();
      table.ordering("sort_order").notNull();
      table.fk("current_file_version_id", this.versionTable).onDelete(
        "Restrict",
      );
      table.timestampUtc("trashed_at");
      table.fk("trashed_by_user_id", "sys_users").onDelete("Restrict");
      if (this.opts.enforceSiblingNameConstraint !== false) {
        table.unique({
          name: "active_file_item_sibling_name",
          fields: [
            "file_space_id",
            { field: "parent_file_item_id", distinctNulls: false },
            "name",
          ],
          where: "trashed_at is null",
        });
      }
      table.recordDisplayName(["name"]);
      table.searchConfig({
        fields: [
          { field: "name", priority: 1 },
          { field: "description", priority: 2 },
        ],
      });
      table.check({
        fields: ["trashed_at", "trashed_by_user_id"],
        errorMessage: () => sql.lit`File item trash metadata is inconsistent.`,
        check: ([trashedAt, trashedBy]) =>
          sql`(${trashedAt} is null and ${trashedBy} is null)
            or (${trashedAt} is not null and ${trashedBy} is not null)`,
      });
      table.skipAutoApi();
    });

    system.db.table(this.versionTable, (table) => {
      table.fk("file_item_id", this.itemTable).notNull().onDelete("Restrict");
      table.uint("version_number").notNull();
      table.string("file_name", 500).notNull();
      table.string("content_type", 255).notNull();
      table.bigUint("byte_length").notNull();
      table.string("note", 2000).multiline();
      table.fk("created_by_user_id", "sys_users").notNull().onDelete(
        "Restrict",
      );
      table.timestampUtc("created_at").notNull().default(sql`now()`);
      table.unique(["file_item_id", "version_number"]);
      table.recordDisplayName(
        ["file_name", "version_number"],
        (name, number) => sql`${name} || ' v' || cast(${number} as string)`,
      );
      table.searchConfig({
        fields: [
          { field: "file_name", priority: 1 },
          { field: "note", priority: 2 },
        ],
      });
      table.skipAutoApi();
    });

    system.db.table(this.versionBlobTable, (table) => {
      table.fk("file_version_id", this.versionTable).notNull().unique()
        .onDelete("Cascade");
      table.blobRef("blob_hash").notNull();
      table.skipAutoApi();
    });

    system.db.table(this.tagTable, (table) => {
      table.fk("file_space_id", this.spaceTable).notNull().onDelete("Cascade");
      table.string("name", 120).notNull();
      table.unique(["file_space_id", "name"]);
      table.recordDisplayName(["name"]);
      table.skipAutoApi();
    });

    system.db.table(this.tagAssignmentTable, (table) => {
      table.fk("file_item_id", this.itemTable).notNull().onDelete("Cascade");
      table.fk("file_tag_id", this.tagTable).notNull().onDelete("Cascade");
      table.unique(["file_item_id", "file_tag_id"]);
      table.skipAutoApi();
    });

    if (this.hasUserGrants) {
      system.db.table("file_space_user_grants", (table) => {
        table.fk("file_space_id", this.spaceTable).notNull().onDelete(
          "Cascade",
        );
        table.fk("sys_user_id", "sys_users").notNull().onDelete("Cascade");
        table.enum("access_level", "file_access_level").notNull();
        table.unique(["file_space_id", "sys_user_id"]);
        table.skipAutoApi();
      });
    }

    if (this.hasPermissionGrants) {
      system.db.table("file_space_permission_grants", (table) => {
        table.fk("file_space_id", this.spaceTable).notNull().onDelete(
          "Cascade",
        );
        table.enum("permission", "auth_permission").notNull();
        table.enum("access_level", "file_access_level").notNull();
        table.unique(["file_space_id", "permission"]);
        table.skipAutoApi();
      });
    }

    for (const extension of this.extensions) extension.initialize(this);
    this.registerAccessFunctions();
  }

  /**
   * Compiles the all-space-type access dispatch and the version/create
   * policies once as db scalar functions. Every `runtimeAccessSql` /
   * `can*Sql` call site emits a `fn.*` call instead of re-inlining the
   * per-type policy expansion.
   */
  private registerAccessFunctions() {
    system.db.scalarFunction({
      name: "drive_space_access",
      description:
        "True when the user has the requested access verb on the file space, dispatching across every configured space type.",
      parameters: [
        { name: "space_id", type: "BigInt" },
        { name: "sys_user_id", type: "BigInt" },
        { name: "verb", type: { type: "String", maxLength: 10 } },
      ],
      returnType: "Bool",
      procedure: (s) => {
        // Copy inputs into locals: `input.*` references inside the return
        // expression's subqueries do not resolve reliably in the JIT.
        s.defScalar("files_access_space_id", {
          expr: sql`input.space_id`,
          allowNoRead: true,
        });
        s.defScalar("files_access_sys_user_id", {
          expr: sql`input.sys_user_id`,
          allowNoRead: true,
        });
        s.defScalar("files_access_verb", {
          expr: sql`input.verb`,
          allowNoRead: true,
        });
        const space = sql`files_runtime_access_space`;
        const user = sql`files_access_sys_user_id`;
        s.return(sql`
          exists (
            select 1
            from db.file_spaces files_runtime_access_space
            where files_runtime_access_space.id = files_access_space_id
              and case files_access_verb
                when 'read'
                  then ${this.accessForSpaceRecordSql(space, user, "read")}
                when 'write'
                  then ${this.accessForSpaceRecordSql(space, user, "write")}
                else ${this.accessForSpaceRecordSql(space, user, "manage")}
              end
          )
        `);
      },
    });
    system.db.scalarFunction({
      name: "drive_can_read_version",
      description:
        "True when the user can read the exact immutable file version, composing space access with extension read policies.",
      parameters: [
        { name: "item_id", type: "BigInt" },
        { name: "version_id", type: "BigInt" },
        { name: "sys_user_id", type: "BigInt" },
      ],
      returnType: "Bool",
      procedure: (s) => {
        s.defScalar("files_read_item_id", {
          expr: sql`input.item_id`,
          allowNoRead: true,
        });
        s.defScalar("files_read_version_id", {
          expr: sql`input.version_id`,
          allowNoRead: true,
        });
        s.defScalar("files_read_sys_user_id", {
          expr: sql`input.sys_user_id`,
          allowNoRead: true,
        });
        s.return(sql`
          exists (
            select 1
            from db.file_items files_read_item
            join db.file_spaces files_read_space
              on files_read_space.id = files_read_item.file_space_id
            join db.file_versions files_read_version
              on files_read_version.id = files_read_version_id
              and files_read_version.file_item_id = files_read_item.id
            where files_read_item.id = files_read_item_id
              and ${
          this.canReadVersionPredicate({
            spaceRecord: sql`files_read_space`,
            itemRecord: sql`files_read_item`,
            versionRecord: sql`files_read_version`,
            sysUserId: sql`files_read_sys_user_id`,
          }, { inlineSpaceAccess: true })
        }
          )
        `);
      },
    });
    system.db.scalarFunction({
      name: "drive_can_create_file",
      description:
        "True when the user can create a file at the location, via space write access or an extension creation grant.",
      parameters: [
        { name: "space_id", type: "BigInt" },
        { name: "parent_item_id", type: "BigInt" },
        { name: "sys_user_id", type: "BigInt" },
      ],
      returnType: "Bool",
      procedure: (s) => {
        s.defScalar("files_create_space_id", {
          expr: sql`input.space_id`,
          allowNoRead: true,
        });
        s.defScalar("files_create_parent_item_id", {
          expr: sql`input.parent_item_id`,
          allowNoRead: true,
        });
        s.defScalar("files_create_sys_user_id", {
          expr: sql`input.sys_user_id`,
          allowNoRead: true,
        });
        s.return(this.canCreateFilePredicate({
          spaceId: sql`files_create_space_id`,
          parentItemId: sql`files_create_parent_item_id`,
          sysUserId: sql`files_create_sys_user_id`,
        }));
      },
    });
    system.db.scalarFunction({
      name: "drive_can_create_version",
      description:
        "True when the user can append a new immutable version to the file, via space write access or an extension grant.",
      parameters: [
        { name: "space_id", type: "BigInt" },
        { name: "item_id", type: "BigInt" },
        { name: "sys_user_id", type: "BigInt" },
      ],
      returnType: "Bool",
      procedure: (s) => {
        s.defScalar("files_version_space_id", {
          expr: sql`input.space_id`,
          allowNoRead: true,
        });
        s.defScalar("files_version_item_id", {
          expr: sql`input.item_id`,
          allowNoRead: true,
        });
        s.defScalar("files_version_sys_user_id", {
          expr: sql`input.sys_user_id`,
          allowNoRead: true,
        });
        s.return(this.canCreateVersionPredicate({
          spaceId: sql`files_version_space_id`,
          itemId: sql`files_version_item_id`,
          sysUserId: sql`files_version_sys_user_id`,
        }));
      },
    });
    system.db.scalarFunction({
      name: "drive_can_update_item_metadata",
      description:
        "True when the user can update the file item's name and description, via space write access or an extension grant.",
      parameters: [
        { name: "space_id", type: "BigInt" },
        { name: "item_id", type: "BigInt" },
        { name: "sys_user_id", type: "BigInt" },
      ],
      returnType: "Bool",
      procedure: (s) => {
        s.defScalar("files_metadata_space_id", {
          expr: sql`input.space_id`,
          allowNoRead: true,
        });
        s.defScalar("files_metadata_item_id", {
          expr: sql`input.item_id`,
          allowNoRead: true,
        });
        s.defScalar("files_metadata_sys_user_id", {
          expr: sql`input.sys_user_id`,
          allowNoRead: true,
        });
        s.return(this.canUpdateItemMetadataPredicate({
          spaceId: sql`files_metadata_space_id`,
          itemId: sql`files_metadata_item_id`,
          sysUserId: sql`files_metadata_sys_user_id`,
        }));
      },
    });
  }

  validate() {
    for (
      const required of [
        "sys_users",
        "auth_roles",
        "auth_role_permissions",
        "auth_user_roles",
        "auth_user_role_sources",
        "auth_user_permissions",
        "auth_user_permission_sources",
      ]
    ) {
      if (!system.db.tables[required]) {
        throw new Error(
          `DriveBlock requires AuthBlock table "${required}".`,
        );
      }
    }
    if (!system.enums.auth_permission) {
      throw new Error(`DriveBlock requires AuthBlock's auth_permission enum.`);
    }
    for (const type of this.spaceTypes) {
      if (!type.tableName) continue;
      const table = system.db.tables[type.tableName];
      const domainFields = Object.values(table.fields).filter((field) =>
        field.type === "ForeignKey" &&
        field.name !== "file_space_id"
      );
      if (domainFields.length === 0) {
        throw new Error(
          `DriveBlock space type "${type.name}" must define a domain foreign key.`,
        );
      }
      const domainFieldNames = new Set(
        domainFields.map((field) => field.name),
      );
      const hasUniqueDomainKey = table.uniqueConstraints.some((constraint) => {
        const fields = constraint.fields.map((field) =>
          typeof field === "string" ? field : field.field
        );
        return fields.length === domainFieldNames.size &&
          fields.every((field) => domainFieldNames.has(field));
      });
      if (!hasUniqueDomainKey) {
        throw new Error(
          `DriveBlock space type "${type.name}" must uniquely constrain its domain foreign key fields.`,
        );
      }
    }
    for (const extension of this.extensions) {
      if (extension.validate) extension.validate(this);
    }
  }

  populate() {
    this.registerMutationProcedures();
    this.registerWorkspaceStateProcedure();
    this.registerViewerStateProcedure();
    for (const extension of this.extensions) {
      extension.registerStoredProcedures?.(this);
    }
  }

  private registerViewerStateProcedure() {
    // Every viewer resolves the same authorized version metadata. Keep its
    // permission query out of each route's SSR and state-update functions.
    system.storedProcedure({
      name: "files_viewer_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_file_item_id", type: "BigInt" },
        { name: "p_file_version_id", type: "BigInt" },
        { name: "p_use_current_version", type: "Bool" },
        { name: "p_retained_version", type: "Bool" },
      ],
      outputRecords: [{
        name: "file_viewer",
        fields: [
          { name: "file_item_id", type: "BigInt" },
          { name: "file_space_id", type: "BigInt" },
          { name: "name", type: { type: "String", maxLength: 500 } },
          { name: "file_version_id", type: "BigInt" },
          { name: "version_number", type: "Uint" },
          {
            name: "space_type",
            type: { type: "Enum", enum: "drive_space_type" },
          },
          { name: "content_type", type: { type: "String", maxLength: 255 } },
          { name: "byte_length", type: "BigUint" },
          { name: "blob_hash", type: { type: "Bytes", maxLength: 32 } },
        ],
      }],
      procedure: (s) => {
        s.modify(sql`insert into file_viewer
            select
              item.id as file_item_id,
              item.file_space_id,
              case when p_use_current_version then item.name
                else version.file_name end as name,
              version.id as file_version_id,
              version.version_number,
              space.space_type,
              version.content_type,
              version.byte_length,
              blob.blob_hash
            from db.file_items item
            join db.file_spaces space on space.id = item.file_space_id
            join db.file_versions version
              on version.file_item_id = item.id
              and version.id = case when p_use_current_version then item.current_file_version_id
                else p_file_version_id end
            left join db.file_version_blobs blob
              on blob.file_version_id = version.id
            where item.id = p_file_item_id
              and item.item_kind = 'file'
              and (item.trashed_at is null
                or (p_retained_version and not p_use_current_version))
              and ${
          this.canReadVersionSql({
            spaceRecord: sql`space`,
            itemRecord: sql`item`,
            versionRecord: sql`version`,
            sysUserId: sql`current_user`,
          })
        }
          `);
      },
    });
  }

  private registerWorkspaceStateProcedure() {
    system.storedProcedure({
      name: "files_workspace_space_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_folder_id", type: "BigInt" },
        { name: "p_selected_item_id", type: "BigInt" },
      ],
      outputRecords: [
        {
          name: "files_space",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "name", type: { type: "String", maxLength: 250 } },
            { name: "description", type: { type: "String", maxLength: 2000 } },
          ],
        },
        {
          name: "files_current_folder",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "parent_file_item_id", type: "BigInt" },
            { name: "name", type: { type: "String", maxLength: 500 } },
          ],
        },
      ],
      outputScalars: [
        { name: "files_can_edit", type: "Bool" },
        { name: "files_can_create_file", type: "Bool" },
        { name: "files_can_manage", type: "Bool" },
        { name: "files_custom_ordering", type: "Bool" },
      ],
      outputTables: [
        {
          name: "files_available_tags",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "name", type: { type: "String", maxLength: 120 } },
            { name: "assigned", type: "Bool" },
          ],
        },
      ],
      procedure: (s) => {
        s.modify(sql`
          insert into files_space
          select id, name, description
          from db.file_spaces space
          where space.id = p_space_id
            and ${
          this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "read")
        }
        `);
        s.if(
          sql`files_space.id is null`,
          (s) => s.throwError(sql.lit`This file space is unavailable.`),
        );
        s.setScalar(
          "files_can_edit",
          this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write"),
        );
        s.setScalar(
          "files_can_create_file",
          this.canCreateFileSql({
            spaceId: sql`p_space_id`,
            parentItemId: sql`p_folder_id`,
            sysUserId: sql`current_user`,
          }),
        );
        s.setScalar(
          "files_can_manage",
          this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "manage"),
        );
        s.setScalar(
          "files_custom_ordering",
          this.customOrderingSql(sql`p_space_id`),
        );
        s.modify(sql`
          insert into files_current_folder
          select id, parent_file_item_id, name
          from db.file_items
          where id = p_folder_id
            and file_space_id = p_space_id
            and item_kind = 'folder'
            and trashed_at is null
        `);
        s.modify(sql`
          insert into files_available_tags
          select tag.id, tag.name,
            exists (
              select 1
              from db.file_tag_assignments assignment
              where assignment.file_tag_id = tag.id
                and assignment.file_item_id = p_selected_item_id
            ) as assigned
          from db.file_tags tag
          where tag.file_space_id = p_space_id
          order by tag.name collate nocase
        `);
      },
    });
    system.storedProcedure({
      name: "files_workspace_items_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_folder_id", type: "BigInt" },
        { name: "p_search", type: "String" },
        { name: "p_show_trash", type: "Bool" },
        { name: "p_selected_item_id", type: "BigInt" },
        { name: "p_custom_ordering", type: "Bool" },
      ],
      outputRecords: [
        {
          name: "files_selected_item",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "file_space_id", type: "BigInt" },
            { name: "parent_file_item_id", type: "BigInt" },
            {
              name: "item_kind",
              type: { type: "Enum", enum: "file_item_kind" },
            },
            { name: "name", type: { type: "String", maxLength: 500 } },
            { name: "description", type: { type: "String", maxLength: 2000 } },
            { name: "sort_order", type: "Ordering" },
            { name: "current_file_version_id", type: "BigInt" },
            { name: "trashed_at", type: "TimestampUtc" },
            { name: "trashed_by_user_id", type: "BigInt" },
            { name: "version_number", type: "Uint" },
            {
              name: "version_file_name",
              type: { type: "String", maxLength: 500 },
            },
            { name: "content_type", type: { type: "String", maxLength: 255 } },
            { name: "byte_length", type: "BigUint" },
            { name: "version_created_at", type: "TimestampUtc" },
            { name: "version_creator_id", type: "BigInt" },
          ],
        },
      ],
      outputTables: [
        {
          name: "files_items",
          fields: [
            { name: "id", type: "BigInt" },
            {
              name: "item_kind",
              type: { type: "Enum", enum: "file_item_kind" },
            },
            { name: "name", type: { type: "String", maxLength: 500 } },
            { name: "description", type: { type: "String", maxLength: 2000 } },
            { name: "sort_order", type: "Ordering" },
            { name: "trashed_at", type: "TimestampUtc" },
            { name: "current_file_version_id", type: "BigInt" },
            { name: "version_number", type: "Uint" },
            { name: "content_type", type: { type: "String", maxLength: 255 } },
            { name: "byte_length", type: "BigUint" },
            { name: "modified_at", type: "TimestampUtc" },
            { name: "modified_by", type: { type: "String", maxLength: 500 } },
            { name: "file_count", type: "BigUint" },
            { name: "icon_kind", type: { type: "String", maxLength: 20 } },
            { name: "tag_names", type: "String" },
            { name: "visible_ordinal", type: "BigUint" },
          ],
        },
        {
          name: "files_move_destinations",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "name", type: { type: "String", maxLength: 500 } },
          ],
        },
      ],
      procedure: (s) => {
        const userTable = system.db.tables.sys_users;
        const modifierDisplayName = userTable.recordDisplayName
          ? userTable.getRecordDisplayNameExpr(sql`modifier`)
          : sql`cast(null as string)`;
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "read")
          })`,
          (s) => s.throwError(sql.lit`This file space is unavailable.`),
        );
        s.defTable(
          "files_folder_totals",
          sql`
            with recursive files_folder_subtree as (
              select folder.id as root_id, folder.id as item_id
              from db.file_items folder
              where folder.file_space_id = p_space_id
                and folder.item_kind = 'folder'
                and folder.trashed_at is null
                and not p_show_trash

              union all

              select subtree.root_id, child.id
              from files_folder_subtree subtree
              join db.file_items child
                on child.parent_file_item_id = subtree.item_id
              where child.file_space_id = p_space_id
                and child.trashed_at is null
            )
            select
              subtree.root_id as folder_id,
              count(descendant.id) as file_count,
              max(descendant_version.created_at) as modified_at
            from files_folder_subtree subtree
            join db.file_items descendant
              on descendant.id = subtree.item_id
              and descendant.item_kind <> 'folder'
            join db.file_spaces descendant_space
              on descendant_space.id = descendant.file_space_id
            left join db.file_versions descendant_version
              on descendant_version.id = descendant.current_file_version_id
            where descendant.current_file_version_id is null
              or ${
            this.canReadVersionPredicate({
              spaceRecord: sql`descendant_space`,
              itemRecord: sql`descendant`,
              versionRecord: sql`descendant_version`,
              sysUserId: sql`current_user`,
            }, { skipSpaceAccess: true })
          }
            group by subtree.root_id
          `,
        );
        s.modify(sql`
          insert into files_items
          select
            item.id,
            item.item_kind,
            item.name,
            item.description,
            item.sort_order,
            item.trashed_at,
            item.current_file_version_id,
            version.version_number,
            version.content_type,
            version.byte_length,
            case
              when item.item_kind = 'folder' then folder_totals.modified_at
              else version.created_at
            end as modified_at,
            case
              when item.item_kind = 'folder' then cast(null as string)
              else ${modifierDisplayName}
            end as modified_by,
            case
              when item.item_kind = 'folder' and not p_show_trash
                then coalesce(folder_totals.file_count, 0)
              else cast(null as bigint)
            end as file_count,
            ${
          fileTypeIconKindSql({
            itemKind: sql`item.item_kind`,
            contentType: sql`version.content_type`,
            fileName: sql`item.name`,
          })
        } as icon_kind,
            coalesce((
              select string_agg(tag.name, ', ' order by tag.name)
              from db.file_tag_assignments assignment
              join db.file_tags tag on tag.id = assignment.file_tag_id
              where assignment.file_item_id = item.id
            ), '') as tag_names,
            row_number() over (
              order by
                case when item.item_kind = 'folder' then 0 else 1 end,
                ${
          this.itemOrderSql(
            sql`item`,
            sql`p_custom_ordering`,
          )
        }
            ) as visible_ordinal
          from db.file_items item
          join db.file_spaces item_space
            on item_space.id = item.file_space_id
          left join db.file_versions version
            on version.id = item.current_file_version_id
          left join db.sys_users modifier
            on modifier.id = version.created_by_user_id
          left join files_folder_totals folder_totals
            on folder_totals.folder_id = item.id
          where item.file_space_id = p_space_id
            and (
              item.item_kind = 'folder'
              or item.current_file_version_id is null
              or ${
          this.canReadVersionPredicate({
            spaceRecord: sql`item_space`,
            itemRecord: sql`item`,
            versionRecord: sql`version`,
            sysUserId: sql`current_user`,
          }, { skipSpaceAccess: true })
        }
            )
            and (
              case
                when trim(p_search) <> ''
                  then item.name like
                    ('%' || trim(p_search) || '%') collate nocase
                else (
                  item.parent_file_item_id = p_folder_id
                  or (
                    item.parent_file_item_id is null
                    and p_folder_id is null
                  )
                )
              end
            )
            and (
              (p_show_trash and item.trashed_at is not null)
              or (not p_show_trash and item.trashed_at is null)
            )
          order by
            case when item.item_kind = 'folder' then 0 else 1 end,
            ${
          this.itemOrderSql(
            sql`item`,
            sql`p_custom_ordering`,
          )
        }
        `);
        s.modify(sql`
          insert into files_selected_item
          select
            item.id,
            item.file_space_id,
            item.parent_file_item_id,
            item.item_kind,
            item.name,
            item.description,
            item.sort_order,
            item.current_file_version_id,
            item.trashed_at,
            item.trashed_by_user_id,
            version.version_number,
            version.file_name as version_file_name,
            version.content_type,
            version.byte_length,
            version.created_at as version_created_at,
            creator.id as version_creator_id
          from db.file_items item
          join files_items readable_item on readable_item.id = item.id
          left join db.file_versions version
            on version.id = item.current_file_version_id
          left join db.sys_users creator
            on creator.id = version.created_by_user_id
          where item.id = p_selected_item_id
            and item.file_space_id = p_space_id
        `);
        s.modify(sql`
          insert into files_move_destinations
          select folder.id, folder.name
          from db.file_items folder
          where folder.file_space_id = p_space_id
            and folder.item_kind = 'folder'
            and folder.trashed_at is null
            and folder.id <> p_selected_item_id
            and folder.id not in (
              ${fileItemSubtreeIds(sql`p_selected_item_id`)}
            )
            and (
              files_selected_item.parent_file_item_id is null
              or folder.id <> files_selected_item.parent_file_item_id
            )
          order by folder.name collate nocase
          limit 50
        `);
      },
    });
    system.storedProcedure({
      name: "files_workspace_selection_state",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_selected_item_id", type: "BigInt" },
      ],
      outputScalars: [
        { name: "files_can_create_version", type: "Bool" },
      ],
      outputTables: [
        {
          name: "files_selected_versions",
          fields: [
            { name: "id", type: "BigInt" },
            { name: "version_number", type: "Uint" },
            { name: "file_name", type: { type: "String", maxLength: 500 } },
            { name: "content_type", type: { type: "String", maxLength: 255 } },
            { name: "byte_length", type: "BigUint" },
            { name: "note", type: { type: "String", maxLength: 2000 } },
            { name: "created_at", type: "TimestampUtc" },
            { name: "created_by_user_id", type: "BigInt" },
            { name: "blob_hash", type: { type: "Bytes", maxLength: 32 } },
          ],
        },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "read")
          })`,
          (s) => s.throwError(sql.lit`This file space is unavailable.`),
        );
        s.setScalar(
          "files_can_create_version",
          sql`
            p_selected_item_id is not null
            and exists (
              select 1
              from db.file_items selected_item
              where selected_item.id = p_selected_item_id
                and selected_item.file_space_id = p_space_id
            )
            and ${
            this.canCreateVersionSql({
              spaceId: sql`p_space_id`,
              itemId: sql`p_selected_item_id`,
              sysUserId: sql`current_user`,
            })
          }
          `,
        );
        s.modify(sql`
          insert into files_selected_versions
          select
            version.id,
            version.version_number,
            version.file_name,
            version.content_type,
            version.byte_length,
            version.note,
            version.created_at,
            version.created_by_user_id,
            blob.blob_hash
          from db.file_versions version
          join db.file_items version_item
            on version_item.id = version.file_item_id
          join db.file_spaces version_space
            on version_space.id = version_item.file_space_id
          left join db.file_version_blobs blob
            on blob.file_version_id = version.id
          where version.file_item_id = p_selected_item_id
            and version_item.file_space_id = p_space_id
            and ${
          this.canReadVersionPredicate({
            spaceRecord: sql`version_space`,
            itemRecord: sql`version_item`,
            versionRecord: sql`version`,
            sysUserId: sql`current_user`,
          }, { skipSpaceAccess: true })
        }
          order by version.version_number desc
        `);
      },
    });
  }

  #registerAppEndpoints(registration: DriveApiRegistration) {
    if (this.#apiRegistrations.has(registration.domain)) return;
    this.#apiRegistrations.set(registration.domain, registration);
    this.registerApi(registration);
  }

  accessSql(
    spaceType: DriveSpaceType,
    spaceId: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql {
    this.assertSpaceType(spaceType);
    const space = sql`files_access_space`;
    const access = this.accessForTypeRecordSql(
      spaceType,
      space,
      spaceType.tableName ? sql`files_access_binding` : space,
      sysUserId,
      verb,
    );
    if (spaceType.tableName) {
      return sql`
        exists (
          select 1
          from db.file_spaces files_access_space
          join db.${sql.ref(spaceType.tableName)} files_access_binding
            on files_access_binding.file_space_id = files_access_space.id
          where files_access_space.id = ${spaceId}
            and cast(files_access_space.space_type as string) = ${
        sql.lit(spaceType.name)
      }
            and ${access}
        )
      `;
    }
    return sql`
      exists (
        select 1
        from db.file_spaces files_access_space
        where files_access_space.id = ${spaceId}
          and cast(files_access_space.space_type as string) = ${
      sql.lit(spaceType.name)
    }
          and ${access}
      )
    `;
  }

  runtimeAccessSql(
    spaceId: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql {
    return sql`fn.drive_space_access(${spaceId}, ${sysUserId}, ${
      sql.lit(verb)
    })`;
  }

  private inlineAccessForSpaceIdSql(
    spaceId: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql {
    const branches = this.spaceTypes.map((type) =>
      sql`when ${sql.lit(type.name)} then ${
        this.accessSql(type, spaceId, sysUserId, verb)
      }`
    ).reduce((left, right) => sql`${left} ${right}`, sql``);
    return sql`
      case (
        select cast(files_inline_access_space.space_type as string)
        from db.file_spaces files_inline_access_space
        where files_inline_access_space.id = ${spaceId}
      )
        ${branches}
        else false
      end
    `;
  }

  accessForSpaceRecordSql(
    spaceRecord: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql {
    const spaceId = sql`${spaceRecord}.id`;
    const policies = this.spaceTypes.map((type, index) => {
      const typeMatches = sql`
        cast(${spaceRecord}.space_type as string) = ${sql.lit(type.name)}
      `;
      if (type.tableName) {
        const binding = sql.ref(`files_access_binding_${index}`);
        const access = this.accessForTypeRecordSql(
          type,
          spaceRecord,
          binding,
          sysUserId,
          verb,
        );
        return sql`
          (
            ${typeMatches}
            and exists (
              select 1
              from db.${sql.ref(type.tableName)} ${binding}
              where ${binding}.file_space_id = ${spaceId}
                and ${access}
            )
          )
        `;
      }
      return sql`
        (
          ${typeMatches}
          and ${
        this.accessForTypeRecordSql(
          type,
          spaceRecord,
          spaceRecord,
          sysUserId,
          verb,
        )
      }
        )
      `;
    });
    return sql`(${policies.reduce((left, right) => sql`${left} or ${right}`)})`;
  }

  private accessForTypeRecordSql(
    type: DriveSpaceType,
    spaceRecord: Sql,
    bindingRecord: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ) {
    const callback = verb === "read"
      ? type.access.read
      : verb === "write"
      ? type.access.write
      : type.access.manage ?? type.access.write;
    // Callback results are spliced after `and`; parenthesize so a top-level
    // `or` in a consumer's predicate cannot rebind against the space/type
    // filters.
    return callback
      ? sql`(${callback(spaceRecord, bindingRecord, sysUserId)})`
      : sql`false`;
  }

  canReadVersionSql(context: FileVersionAccessContext): Sql {
    return sql`fn.drive_can_read_version(
      ${context.itemRecord}.id,
      ${context.versionRecord}.id,
      ${context.sysUserId}
    )`;
  }

  canReadVersionForAuthorizedSpaceSql(
    context: FileVersionAccessContext,
  ): Sql {
    return this.canReadVersionPredicate(context, { skipSpaceAccess: true });
  }

  /**
   * Inline body of `fn.drive_can_read_version`. Used inside the scalar
   * function for point lookups, and directly at the per-row workspace list
   * sites (items list, version history) where the space/item/version records
   * are already joined and a per-row function call over re-fetched records
   * would defeat storage pruning of the surrounding query.
   *
   * The space-access piece must take a different form per consumer.
   * `inlineSpaceAccess` is required inside `fn.drive_can_read_version`
   * (a nested `fn.drive_space_access` call there misevaluated - the
   * "file unavailable" bug). Workspace list procedures authorize their
   * space once before the query and use `skipSpaceAccess` here so only
   * extension-specific version policies remain in the per-row predicate.
   */
  private canReadVersionPredicate(
    context: FileVersionAccessContext,
    opts?: { inlineSpaceAccess?: boolean; skipSpaceAccess?: boolean },
  ): Sql {
    const extensionPolicies = this.extensions
      .filter((extension) => extension.canReadVersion)
      .map((extension) =>
        sql`
          (
            not (${
          this.extensionEnabledForTypeSql(
            sql`${context.spaceRecord}.space_type`,
            extension.name,
          )
        })
            or ${extension.canReadVersion?.(context) ?? sql`true`}
          )
        `
      );
    const extensionAccess = extensionPolicies.length
      ? extensionPolicies.reduce((left, right) => sql`${left} and ${right}`)
      : sql`true`;
    const spaceAccess = opts?.skipSpaceAccess
      ? sql`true`
      : opts?.inlineSpaceAccess
      ? this.accessForSpaceRecordSql(
        context.spaceRecord,
        context.sysUserId,
        "read",
      )
      : this.runtimeAccessSql(
        sql`${context.spaceRecord}.id`,
        context.sysUserId,
        "read",
      );
    return sql`
      ${spaceAccess}
      and ${extensionAccess}
    `;
  }

  canCreateFileSql(context: FileCreateAccessContext): Sql {
    return sql`fn.drive_can_create_file(
      ${context.spaceId},
      ${context.parentItemId},
      ${context.sysUserId}
    )`;
  }

  private canCreateFilePredicate(
    context: FileCreateAccessContext,
    opts?: { inlineSpaceAccess?: boolean },
  ): Sql {
    const extensionPolicies = this.extensions
      .filter((extension) => extension.canCreateFile)
      .map((extension) =>
        sql`
          (
            ${this.extensionEnabledSql(context.spaceId, extension.name)}
            and ${extension.canCreateFile?.(context) ?? sql`false`}
          )
        `
      );
    const extensionAccess = extensionPolicies.length
      ? extensionPolicies.reduce((left, right) => sql`${left} or ${right}`)
      : sql`false`;
    const writeAccess = opts?.inlineSpaceAccess
      ? this.inlineAccessForSpaceIdSql(
        context.spaceId,
        context.sysUserId,
        "write",
      )
      : this.runtimeAccessSql(context.spaceId, context.sysUserId, "write");
    const readAccess = opts?.inlineSpaceAccess
      ? this.inlineAccessForSpaceIdSql(
        context.spaceId,
        context.sysUserId,
        "read",
      )
      : this.runtimeAccessSql(context.spaceId, context.sysUserId, "read");
    return sql`(
      ${writeAccess}
      or (
        ${readAccess}
        and (${extensionAccess})
      )
    )`;
  }

  canCreateVersionSql(context: FileVersionCreateAccessContext): Sql {
    return sql`fn.drive_can_create_version(
      ${context.spaceId},
      ${context.itemId},
      ${context.sysUserId}
    )`;
  }

  private canCreateVersionPredicate(
    context: FileVersionCreateAccessContext,
    opts?: { inlineSpaceAccess?: boolean },
  ): Sql {
    const extensionPolicies = this.extensions
      .filter((extension) => extension.canCreateVersion)
      .map((extension) =>
        sql`
          (
            ${this.extensionEnabledSql(context.spaceId, extension.name)}
            and ${extension.canCreateVersion?.(context) ?? sql`false`}
          )
        `
      );
    const extensionAccess = extensionPolicies.length
      ? extensionPolicies.reduce((left, right) => sql`${left} or ${right}`)
      : sql`false`;
    const writeAccess = opts?.inlineSpaceAccess
      ? this.inlineAccessForSpaceIdSql(
        context.spaceId,
        context.sysUserId,
        "write",
      )
      : this.runtimeAccessSql(context.spaceId, context.sysUserId, "write");
    const readAccess = opts?.inlineSpaceAccess
      ? this.inlineAccessForSpaceIdSql(
        context.spaceId,
        context.sysUserId,
        "read",
      )
      : this.runtimeAccessSql(context.spaceId, context.sysUserId, "read");
    return sql`(
      ${writeAccess}
      or (
        ${readAccess}
        and (${extensionAccess})
      )
    )`;
  }

  canUpdateItemMetadataSql(context: FileItemUpdateAccessContext): Sql {
    return sql`fn.drive_can_update_item_metadata(
      ${context.spaceId},
      ${context.itemId},
      ${context.sysUserId}
    )`;
  }

  private canUpdateItemMetadataPredicate(
    context: FileItemUpdateAccessContext,
  ): Sql {
    const extensionPolicies = this.extensions
      .filter((extension) => extension.canUpdateItemMetadata)
      .map((extension) =>
        sql`
          (
            ${this.extensionEnabledSql(context.spaceId, extension.name)}
            and ${extension.canUpdateItemMetadata?.(context) ?? sql`false`}
          )
        `
      );
    const extensionAccess = extensionPolicies.length
      ? extensionPolicies.reduce((left, right) => sql`${left} or ${right}`)
      : sql`false`;
    return sql`(
      ${this.runtimeAccessSql(context.spaceId, context.sysUserId, "write")}
      or (
        ${this.runtimeAccessSql(context.spaceId, context.sysUserId, "read")}
        and (${extensionAccess})
      )
    )`;
  }

  versionBlobUrl(versionId: Sql, blobHash?: Sql): Sql {
    return sql`
      '/api/files/versions/' || cast(${versionId} as string) || '/content'
      ${
      blobHash
        ? sql` || '?v=' || coalesce(bytes.to_hex(${blobHash}), '')`
        : sql``
    }
    `;
  }

  ensureBoundSpace<T extends StatementsBase<any>>(
    s: T,
    opts: EnsureBoundSpaceOpts,
  ) {
    const type = opts.type;
    this.assertSpaceType(type);
    if (!type.tableName || !type.define) {
      throw new Error(
        `DriveBlock space type "${type.name}" is standalone; use createSpace instead.`,
      );
    }
    const bindingTable = type.tableName;
    if (Object.keys(opts.values).length === 0) {
      throw new Error("DriveBlock.ensureBoundSpace requires binding values.");
    }
    const result = opts.into ?? "file_space_id";
    const fields = Object.keys(opts.values);
    const bindingConditions = fields.reduce(
      (conditions, field) =>
        sql`${conditions}
          and typed.${sql.ref(field)} = ${opts.values[field]}`,
      sql``,
    );
    s.defScalar(
      result,
      sql`(
        select typed.file_space_id as value
        from db.${sql.ref(bindingTable)} typed
        join db.file_spaces space on space.id = typed.file_space_id
        where cast(space.space_type as string) = ${sql.lit(type.name)}
          ${bindingConditions}
        limit 1
      )`,
    );
    s.if(sql`${sql.ref(result)} is null`, (s) => {
      s.modify(sql`
        insert into db.file_spaces (
          space_type,
          name,
          description
        ) values (
          ${sql.lit(type.name)},
          ${opts.name},
          ${opts.description ?? sql`cast(null as string)`}
        )
      `);
      s.setScalar(result, sql`last_record_id(db.file_spaces)`);
      s.modify(sql`
        insert into db.${sql.ref(bindingTable)} (
          file_space_id,
          ${fields.map((field) => sql.ref(field))}
        ) values (
          ${sql.ref(result)},
          ${fields.map((field) => opts.values[field])}
        )
      `);
    });
  }

  createSpace<T extends ServerStatementsBase<any>>(
    s: T,
    opts: CreateSpaceOpts,
  ) {
    const type = opts.type;
    this.assertSpaceType(type);
    if (type.tableName) {
      throw new Error(
        `DriveBlock space type "${type.name}" is record-bound; use ensureBoundSpace instead.`,
      );
    }
    if (opts.into) {
      s.defScalar(opts.into, { type: "BigInt" });
    }
    s.if(
      sql`not (${type.canCreate?.(opts.sysUserId) ?? sql`false`})`,
      (s) =>
        s.throwError(
          sql.lit`You cannot create this type of file space.`,
        ),
    );
    s.if(
      sql`nullif(trim(${opts.name}), '') is null`,
      (s) => s.throwError(sql.lit`Enter a name for this file space.`),
    );
    if (type.owner) {
      s.if(
        sql`${opts.sysUserId} is null`,
        (s) => s.throwError(sql.lit`This file space requires an owner.`),
      );
      s.modify(sql`
        insert into db.file_spaces (
          space_type,
          name,
          description,
          owner_user_id
        ) values (
          ${sql.lit(type.name)},
          trim(${opts.name}),
          ${opts.description ?? sql`cast(null as string)`},
          ${opts.sysUserId}
        )
      `);
    } else {
      s.modify(sql`
        insert into db.file_spaces (
          space_type,
          name,
          description
        ) values (
          ${sql.lit(type.name)},
          trim(${opts.name}),
          ${opts.description ?? sql`cast(null as string)`}
        )
      `);
    }
    if (opts.into) {
      s.setScalar(opts.into, sql`last_record_id(db.file_spaces)`);
    }
  }

  createFolder<T extends StatementsBase<any>>(
    s: T,
    opts: CreateFolderOpts,
  ) {
    this.assertValidItemName(s, opts.name);
    this.assertParent(s, opts.spaceId, opts.parentItemId);
    this.assertUniqueSiblingName(
      s,
      opts.spaceId,
      opts.parentItemId,
      opts.name,
    );
    s.modify(sql`
      insert into db.file_items (
        file_space_id,
        parent_file_item_id,
        item_kind,
        name,
        sort_order
      )
      values (
        ${opts.spaceId},
        ${opts.parentItemId ?? sql`cast(null as bigint)`},
        'folder',
        trim(${opts.name}),
        ordering.new((
          select max(sibling.sort_order)
          from db.file_items sibling
          where sibling.file_space_id = ${opts.spaceId}
            and coalesce(
              cast(sibling.parent_file_item_id as string),
              ''
            ) = coalesce(
              cast(${opts.parentItemId ?? sql`cast(null as bigint)`} as string),
              ''
            )
            and sibling.trashed_at is null
        ))
      )
    `);
    if (opts.into) {
      s.defScalar(opts.into, sql`last_record_id(db.file_items)`);
    }
  }

  createFileVersion<T extends ServerStatementsBase<any>>(
    s: T,
    opts: CreateFileVersionOpts,
  ) {
    s.callStoredProcedure("files_append_version", {
      inputScalars: {
        p_item_id: opts.itemId,
        p_file_name: opts.fileName,
        p_content_type: opts.contentType,
        p_byte_length: opts.byteLength,
        p_blob_hash: opts.blobHash ??
          sql`bytes.from_hex(cast(null as string))`,
        p_note: opts.note ?? sql`cast(null as string)`,
        p_sys_user_id: opts.sysUserId,
      },
      outputScalars: {
        files_appended_version_id: opts.intoVersion ??
          "created_file_version_id",
      },
    });
  }

  createFileItem<T extends ServerStatementsBase<any>>(
    s: T,
    opts: CreateFileItemOpts,
  ) {
    s.callStoredProcedure("files_create_file", {
      inputScalars: {
        p_space_id: opts.spaceId,
        p_parent_item_id: opts.parentItemId ?? sql`cast(null as bigint)`,
        p_name: opts.name,
        p_description: opts.description ?? sql`cast(null as string)`,
      },
      outputScalars: {
        files_created_item_id: opts.into,
      },
    });
  }

  moveItem<T extends ServerStatementsBase<any>>(
    s: T,
    opts: MoveFileItemOpts,
  ) {
    this.assertParent(
      s,
      opts.spaceId,
      opts.destinationParentItemId,
    );
    s.if(
      sql`
        not exists (
          select 1
          from db.file_items moving_item
          where moving_item.id = ${opts.itemId}
            and moving_item.file_space_id = ${opts.spaceId}
            and moving_item.trashed_at is null
        )
      `,
      (s) => s.throwError(sql.lit`The item is unavailable.`),
    );
    if (this.opts.enforceSiblingNameConstraint !== false) {
      s.defScalar(
        "files_move_item_name",
        sql`(select name from db.file_items where id = ${opts.itemId})`,
      );
      this.assertUniqueSiblingName(
        s,
        opts.spaceId,
        opts.destinationParentItemId,
        sql`files_move_item_name`,
        opts.itemId,
      );
    }
    s.if(
      sql`
        ${opts.destinationParentItemId} is not null
        and ${opts.destinationParentItemId} in (
          ${fileItemSubtreeIds(opts.itemId)}
        )
      `,
      (s) => s.throwError(sql.lit`A folder cannot be moved inside itself.`),
    );
    s.modify(sql`
      update db.file_items
      set
        parent_file_item_id = ${opts.destinationParentItemId},
        sort_order = ordering.new((
          select max(sibling.sort_order)
          from db.file_items sibling
          where sibling.file_space_id = ${opts.spaceId}
            and (
              sibling.parent_file_item_id = ${opts.destinationParentItemId}
              or (
                sibling.parent_file_item_id is null
                and ${opts.destinationParentItemId} is null
              )
            )
            and sibling.id <> ${opts.itemId}
            and sibling.trashed_at is null
        ))
      where id = ${opts.itemId}
        and file_space_id = ${opts.spaceId}
    `);
  }

  updateItemMetadata<T extends ServerStatementsBase<any>>(
    s: T,
    opts: UpdateFileItemMetadataOpts,
  ) {
    s.if(
      sql`
        not exists (
          select 1
          from db.file_items item
          where item.id = ${opts.itemId}
            and item.file_space_id = ${opts.spaceId}
            and item.trashed_at is null
        )
        or not (${
        this.canUpdateItemMetadataSql({
          spaceId: opts.spaceId,
          itemId: opts.itemId,
          sysUserId: opts.sysUserId,
        })
      })
      `,
      (s) => s.throwError(sql.lit`You cannot update this file.`),
    );
    this.assertValidItemName(s, opts.name);
    this.assertUniqueSiblingName(
      s,
      opts.spaceId,
      sql`(
        select parent_file_item_id
        from db.file_items
        where id = ${opts.itemId}
      )`,
      opts.name,
      opts.itemId,
    );
    s.modify(sql`
      update db.file_items
      set
        name = trim(${opts.name}),
        description = nullif(trim(${opts.description}), '')
      where id = ${opts.itemId}
        and file_space_id = ${opts.spaceId}
        and trashed_at is null
    `);
  }

  private assertSpaceType(type: DriveSpaceType) {
    if (!this.spaceTypes.includes(type)) {
      throw new Error(
        `DriveBlock space type "${type.name}" must be one of this block's configured space-type objects.`,
      );
    }
  }

  private assertValidItemName<T extends StatementsBase<any>>(
    s: T,
    name: Sql,
  ) {
    s.if(
      sql`not (${this.validItemNameSql(name)})`,
      (s) => s.throwError(sql.lit`Enter a valid file or folder name.`),
    );
  }

  private validItemNameSql(name: Sql): Sql {
    return sql`
      nullif(trim(coalesce(${name}, '')), '') is not null
      and trim(${name}) not in ('.', '..')
      and position('/' in ${name}) = 0
      and position(chr(92) in ${name}) = 0
      and position(chr(10) in ${name}) = 0
      and position(chr(13) in ${name}) = 0
    `;
  }

  private assertParent<T extends StatementsBase<any>>(
    s: T,
    spaceId: Sql,
    parentItemId?: Sql,
  ) {
    if (!parentItemId) return;
    s.if(
      sql`
        ${parentItemId} is not null
        and not exists (
          select 1
          from db.file_items parent
          where parent.id = ${parentItemId}
            and parent.file_space_id = ${spaceId}
            and parent.item_kind = 'folder'
            and parent.trashed_at is null
        )
      `,
      (s) => s.throwError(sql.lit`The destination folder is unavailable.`),
    );
  }

  private assertUniqueSiblingName<T extends StatementsBase<any>>(
    s: T,
    spaceId: Sql,
    parentItemId: Sql | undefined,
    name: Sql,
    exceptItemId?: Sql,
  ) {
    if (this.opts.enforceSiblingNameConstraint === false) {
      return;
    }
    s.if(
      sql`
        exists (
          select 1
          from db.file_items sibling
          where sibling.file_space_id = ${spaceId}
            and coalesce(
              cast(sibling.parent_file_item_id as string),
              ''
            ) = coalesce(
              cast(${parentItemId ?? sql`cast(null as bigint)`} as string),
              ''
            )
            and trim(sibling.name) = trim(${name}) collate nocase
            and sibling.trashed_at is null
            ${exceptItemId ? sql`and sibling.id <> ${exceptItemId}` : sql``}
        )
      `,
      (s) =>
        s.throwError(
          sql.lit`A file or folder with that name already exists here.`,
        ),
    );
  }

  private authenticateApi(
    s: EndpointStatements,
    registration: DriveApiRegistration,
  ) {
    AuthBlock.validateApi(s, registration.cookieName);
    applySignedTransferIdentity(s);
    s.if(sql`auth_user_id is null and current_user is not null`, (s) => {
      s.setScalar("auth_user_id", sql`current_user`);
    });
    s.if(sql`auth_user_id is null`, (s) => {
      s.setHttpStatus(401);
      s.return(sql.lit`Not authenticated`);
    });
  }

  private registerMutationProcedures() {
    system.storedProcedure({
      name: "files_create_file",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_parent_item_id", type: "BigInt" },
        { name: "p_name", type: { type: "String", maxLength: 500 } },
        { name: "p_description", type: { type: "String", maxLength: 2000 } },
      ],
      outputScalars: [
        { name: "files_created_item_id", type: "BigInt" },
      ],
      procedure: (s) => {
        this.assertValidItemName(s, sql`p_name`);
        this.assertParent(s, sql`p_space_id`, sql`p_parent_item_id`);
        this.assertUniqueSiblingName(
          s,
          sql`p_space_id`,
          sql`p_parent_item_id`,
          sql`p_name`,
        );
        s.defScalar("files_inserted_item_id", { type: "BigInt" });
        s.modify(sql`
          insert into db.file_items (
            file_space_id,
            parent_file_item_id,
            item_kind,
            name,
            description,
            sort_order
          ) values (
            p_space_id,
            p_parent_item_id,
            'file',
            trim(p_name),
            p_description,
            ordering.new((
              select max(sibling.sort_order)
              from db.file_items sibling
              where sibling.file_space_id = p_space_id
                and coalesce(
                  cast(sibling.parent_file_item_id as string),
                  ''
                ) = coalesce(cast(p_parent_item_id as string), '')
                and sibling.trashed_at is null
            ))
          )
          returning id into files_inserted_item_id
        `);
        s.setScalar("files_created_item_id", sql`files_inserted_item_id`);
      },
    });
    system.storedProcedure({
      name: "files_append_version",
      transaction: "caller",
      inputScalars: [
        { name: "p_item_id", type: "BigInt" },
        { name: "p_file_name", type: { type: "String", maxLength: 500 } },
        { name: "p_content_type", type: { type: "String", maxLength: 255 } },
        { name: "p_byte_length", type: "BigUint" },
        { name: "p_blob_hash", type: { type: "Bytes", maxLength: 32 } },
        { name: "p_note", type: { type: "String", maxLength: 2000 } },
        { name: "p_sys_user_id", type: "BigInt" },
      ],
      outputScalars: [
        { name: "files_appended_version_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.defScalar("files_appended_version_number", {
          type: "BigInt",
          expr: sql`
            coalesce((
              select max(version.version_number)
              from db.file_versions version
              where version.file_item_id = p_item_id
            ), 0) + 1
          `,
        });
        s.throwErrorIf(
          sql`exists (
            select 1
            from db.file_versions first_version
            where first_version.file_item_id = p_item_id
              and first_version.version_number = 1
              and lower(trim(first_version.content_type)) <>
                lower(trim(p_content_type))
          )`,
          sql.lit`A file's content type cannot change between versions.`,
        );
        s.modify(sql`
          insert into db.file_versions (
            file_item_id,
            version_number,
            file_name,
            content_type,
            byte_length,
            note,
            created_by_user_id
          ) values (
            p_item_id,
            files_appended_version_number,
            p_file_name,
            lower(trim(p_content_type)),
            p_byte_length,
            p_note,
            p_sys_user_id
          )
          returning id into files_appended_version_id
        `);
        s.if(sql`p_blob_hash is not null`, (s) => {
          s.modify(sql`
            insert into db.file_version_blobs (file_version_id, blob_hash)
            values (files_appended_version_id, p_blob_hash)
          `);
        });
        s.modify(sql`
          update db.file_items
          set current_file_version_id = files_appended_version_id
          where id = p_item_id
            and item_kind = 'file'
        `);
        const event: FileVersionCreatedEvent = {
          spaceId:
            sql`(select file_space_id from db.file_items where id = p_item_id)`,
          itemId: sql`p_item_id`,
          versionId: sql`files_appended_version_id`,
          versionNumber: sql`files_appended_version_number`,
          fileName: sql`p_file_name`,
          contentType: sql`p_content_type`,
          byteLength: sql`p_byte_length`,
          sysUserId: sql`p_sys_user_id`,
        };
        for (const extension of this.extensions) {
          const onVersionCreated = extension.onVersionCreated;
          if (!onVersionCreated) continue;
          s.if(
            this.extensionEnabledSql(event.spaceId, extension.name),
            (s) => onVersionCreated.call(extension, s, event),
          );
        }
      },
    });
    system.storedProcedure({
      name: "files_update_item_metadata",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
        { name: "p_name", type: { type: "String", maxLength: 500 } },
        { name: "p_description", type: { type: "String", maxLength: 2000 } },
      ],
      procedure: (s) => {
        this.updateItemMetadata(s, {
          spaceId: sql`p_space_id`,
          itemId: sql`p_item_id`,
          name: sql`p_name`,
          description: sql`p_description`,
          sysUserId: sql`current_user`,
        });
      },
    });
    system.storedProcedure({
      name: "files_move_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
        { name: "p_destination_parent_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot move files in this space.`),
        );
        this.moveItem(s, {
          spaceId: sql`p_space_id`,
          itemId: sql`p_item_id`,
          destinationParentItemId: sql`p_destination_parent_id`,
          sysUserId: sql`current_user`,
        });
      },
    });
    system.storedProcedure({
      name: "files_trash_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot trash files in this space.`),
        );
        s.defScalar("files_trash_marker", sql`now()`);
        s.modify(sql`
          update db.file_items
          set
            trashed_at = files_trash_marker,
            trashed_by_user_id = current_user
          where file_space_id = p_space_id
            and id in (
              ${fileItemSubtreeIds(sql`p_item_id`)}
            )
            and trashed_at is null
        `);
      },
    });
    system.storedProcedure({
      name: "files_restore_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot restore files in this space.`),
        );
        s.defRecord(
          "files_restore_item_record",
          sql`
            select id, parent_file_item_id, name, trashed_at
            from db.file_items
            where id = p_item_id
              and file_space_id = p_space_id
              and trashed_at is not null
          `,
        );
        s.if(
          sql`files_restore_item_record.id is null`,
          (s) => s.throwError(sql.lit`The trashed item is unavailable.`),
        );
        this.assertUniqueSiblingName(
          s,
          sql`p_space_id`,
          sql`files_restore_item_record.parent_file_item_id`,
          sql`files_restore_item_record.name`,
          sql`p_item_id`,
        );
        s.defScalar(
          "files_restore_marker",
          sql`files_restore_item_record.trashed_at`,
        );
        s.modify(sql`
          update db.file_items
          set
            trashed_at = null,
            trashed_by_user_id = null
          where file_space_id = p_space_id
            and trashed_at = files_restore_marker
            and id in (
              ${fileItemSubtreeIds(sql`p_item_id`)}
            )
        `);
      },
    });
    system.storedProcedure({
      name: "files_create_folder",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_parent_item_id", type: "BigInt" },
        { name: "p_name", type: "String" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot change files in this space.`),
        );
        this.createFolder(s, {
          spaceId: sql`p_space_id`,
          parentItemId: sql`p_parent_item_id`,
          name: sql`p_name`,
        });
      },
    });
    system.storedProcedure({
      name: "files_rename_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
        { name: "p_name", type: "String" },
      ],
      procedure: (s) => {
        // Rename routes through the shared metadata update so it uses the
        // same validation and authorization as updateItemMetadata.
        this.updateItemMetadata(s, {
          spaceId: sql`p_space_id`,
          itemId: sql`p_item_id`,
          name: sql`p_name`,
          description: sql`(
            select description from db.file_items where id = p_item_id
          )`,
          sysUserId: sql`current_user`,
        });
      },
    });
    system.storedProcedure({
      name: "files_swap_item_order",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
        { name: "p_earlier", type: "Bool" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot change files in this space.`),
        );
        s.if(
          sql`not (${this.customOrderingSql(sql`p_space_id`)})`,
          (s) =>
            s.throwError(
              sql.lit`Custom ordering is not enabled for this space.`,
            ),
        );
        s.defRecord(
          "files_swap_item",
          sql`
            select id, item_kind, parent_file_item_id, sort_order
            from db.file_items
            where id = p_item_id
              and file_space_id = p_space_id
              and trashed_at is null
          `,
        );
        s.defRecord(
          "files_reorder_neighbor",
          sql`
            select neighbor.id, neighbor.sort_order
            from db.file_items neighbor
            where neighbor.file_space_id = p_space_id
              and neighbor.item_kind = files_swap_item.item_kind
              and (
                neighbor.parent_file_item_id =
                  files_swap_item.parent_file_item_id
                or (
                  neighbor.parent_file_item_id is null
                  and files_swap_item.parent_file_item_id is null
                )
              )
              and neighbor.trashed_at is null
              and case
                when p_earlier then (
                  neighbor.sort_order < files_swap_item.sort_order
                  or (
                    neighbor.sort_order = files_swap_item.sort_order
                    and neighbor.id < files_swap_item.id
                  )
                )
                else (
                  neighbor.sort_order > files_swap_item.sort_order
                  or (
                    neighbor.sort_order = files_swap_item.sort_order
                    and neighbor.id > files_swap_item.id
                  )
                )
              end
            order by
              case when p_earlier then neighbor.sort_order end desc,
              case when p_earlier then neighbor.id end desc,
              case when not p_earlier then neighbor.sort_order end,
              case when not p_earlier then neighbor.id end
            limit 1
          `,
        );
        s.if(sql`files_reorder_neighbor.id is not null`, (s) => {
          s.modify(sql`
            update db.file_items
            set sort_order = files_swap_item.sort_order
            where id = files_reorder_neighbor.id
          `);
          s.modify(sql`
            update db.file_items
            set sort_order = files_reorder_neighbor.sort_order
            where id = files_swap_item.id
          `);
        });
      },
    });
    system.storedProcedure({
      name: "files_drop_reorder_item",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
        { name: "p_target_item_id", type: "BigInt" },
        { name: "p_position", type: { type: "String", maxLength: 10 } },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot change files in this space.`),
        );
        s.if(
          sql`not (${this.customOrderingSql(sql`p_space_id`)})`,
          (s) =>
            s.throwError(
              sql.lit`Custom ordering is not enabled for this space.`,
            ),
        );
        s.defRecord(
          "files_dragged_item",
          sql`
            select
              dragged.id,
              dragged.item_kind,
              dragged.parent_file_item_id
            from db.file_items dragged
            where dragged.id = p_item_id
              and dragged.file_space_id = p_space_id
              and dragged.trashed_at is null
          `,
        );
        s.defRecord(
          "files_drop_target",
          sql`
            select
              target.id,
              target.item_kind,
              target.parent_file_item_id,
              target.sort_order
            from db.file_items target
            where target.id = p_target_item_id
              and target.file_space_id = p_space_id
              and target.trashed_at is null
          `,
        );
        s.if(
          sql`
            files_dragged_item.id is null
            or files_drop_target.id is null
            or files_dragged_item.item_kind !=
              files_drop_target.item_kind
            or not (
              files_dragged_item.parent_file_item_id =
                files_drop_target.parent_file_item_id
              or (
                files_dragged_item.parent_file_item_id is null
                and files_drop_target.parent_file_item_id is null
              )
            )
          `,
          (s) =>
            s.throwError(
              sql
                .lit`Items can only be reordered within their current folder.`,
            ),
        );
        s.defScalar(
          "files_reorder_before",
          sql`case
            when p_position = 'before' then (
              select max(sibling.sort_order)
              from db.file_items sibling
              where sibling.file_space_id = p_space_id
                and sibling.item_kind =
                  files_drop_target.item_kind
                and (
                  sibling.parent_file_item_id =
                    files_drop_target.parent_file_item_id
                  or (
                    sibling.parent_file_item_id is null
                    and files_drop_target.parent_file_item_id is null
                  )
                )
                and sibling.trashed_at is null
                and sibling.id not in (
                  files_dragged_item.id,
                  files_drop_target.id
                )
                and sibling.sort_order <
                  files_drop_target.sort_order
            )
            else files_drop_target.sort_order
          end`,
        );
        s.defScalar(
          "files_reorder_after",
          sql`case
            when p_position = 'after' then (
              select min(sibling.sort_order)
              from db.file_items sibling
              where sibling.file_space_id = p_space_id
                and sibling.item_kind =
                  files_drop_target.item_kind
                and (
                  sibling.parent_file_item_id =
                    files_drop_target.parent_file_item_id
                  or (
                    sibling.parent_file_item_id is null
                    and files_drop_target.parent_file_item_id is null
                  )
                )
                and sibling.trashed_at is null
                and sibling.id not in (
                  files_dragged_item.id,
                  files_drop_target.id
                )
                and sibling.sort_order >
                  files_drop_target.sort_order
            )
            else files_drop_target.sort_order
          end`,
        );
        s.modify(sql`
          update db.file_items
          set sort_order = ordering.new(
            files_reorder_before,
            files_reorder_after
          )
          where id = files_dragged_item.id
        `);
      },
    });
    system.storedProcedure({
      name: "files_toggle_item_tag",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_item_id", type: "BigInt" },
        { name: "p_tag_id", type: "BigInt" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "write")
          })`,
          (s) => s.throwError(sql.lit`You cannot change files in this space.`),
        );
        s.if(
          sql`
            not exists (
              select 1
              from db.file_items item
              join db.file_tags tag on tag.file_space_id = item.file_space_id
              where item.id = p_item_id
                and item.file_space_id = p_space_id
                and tag.id = p_tag_id
            )
          `,
          (s) => s.throwError(sql.lit`This tag is unavailable.`),
        );
        s.if(
          sql`
            exists (
              select 1
              from db.file_tag_assignments assignment
              where assignment.file_item_id = p_item_id
                and assignment.file_tag_id = p_tag_id
            )
          `,
          (s) => {
            s.modify(sql`
              delete from db.file_tag_assignments
              where file_item_id = p_item_id
                and file_tag_id = p_tag_id
            `);
          },
        ).else((s) => {
          s.modify(sql`
            insert into db.file_tag_assignments (
              file_item_id,
              file_tag_id
            ) values (
              p_item_id,
              p_tag_id
            )
          `);
        });
      },
    });
    system.storedProcedure({
      name: "files_create_tag",
      transaction: "caller",
      inputScalars: [
        { name: "p_space_id", type: "BigInt" },
        { name: "p_name", type: "String" },
      ],
      procedure: (s) => {
        s.if(
          sql`not (${
            this.runtimeAccessSql(sql`p_space_id`, sql`current_user`, "manage")
          })`,
          (s) =>
            s.throwError(
              sql.lit`Only file-space managers can create tags.`,
            ),
        );
        s.if(
          sql`
            exists (
              select 1
              from db.file_tags tag
              where tag.file_space_id = p_space_id
                and tag.name = trim(p_name) collate nocase
            )
          `,
          (s) => s.throwError(sql.lit`That tag already exists.`),
        );
        s.modify(sql`
          insert into db.file_tags (
            file_space_id,
            name
          ) values (
            p_space_id,
            trim(p_name)
          )
        `);
      },
    });
  }

  private registerApi(registration: DriveApiRegistration) {
    const api = system.api({
      // A domain has one composable API builder. Keep the shared `/api`
      // prefix so Drive can coexist with domain-specific endpoints, and
      // namespace only Drive's own routes.
      prefix: "/api",
      domain: registration.domain,
    });

    api.get("/files/versions/{version_id:id}/content", {
      procedure: (s) => {
        this.authenticateApi(s, registration);
        s.defRecord(
          "requested_file_version",
          sql`
            select
              version.id,
              version.file_name,
              version.content_type,
              item.file_space_id,
              blob.blob_hash
            from db.file_versions version
            join db.file_items item on item.id = version.file_item_id
            join db.file_spaces space on space.id = item.file_space_id
            join db.file_version_blobs blob on blob.file_version_id = version.id
            where version.id = version_id
              and ${
            this.canReadVersionSql({
              spaceRecord: sql`space`,
              itemRecord: sql`item`,
              versionRecord: sql`version`,
              sysUserId: sql`auth_user_id`,
            })
          }
          `,
        );
        s.if(sql`requested_file_version.id is null`, (s) => {
          s.setHttpStatus(404);
          s.return(sql.lit`File version not found`);
        });
        s.defScalar(
          "requested_file_version_can_inline",
          sql`
            signed_transfer_claims is null and requested_file_version.content_type collate nocase in (
              'application/pdf',
              'image/avif',
              'image/bmp',
              'image/gif',
              'image/jpeg',
              'image/png',
              'image/tiff',
              'image/webp',
              'text/plain'
            )
          `,
        );
        s.setHeader(
          sql.lit`Content-Type`,
          sql`
            case
              when requested_file_version_can_inline
                then requested_file_version.content_type
              else 'application/octet-stream'
            end
          `,
        );
        s.setHeader(
          sql.lit`X-Content-Type-Options`,
          sql.lit`nosniff`,
        );
        s.setHeader(
          sql.lit`Content-Security-Policy`,
          sql.lit`sandbox`,
        );
        s.setHeader(
          sql.lit`Cache-Control`,
          sql`case when signed_transfer_claims is not null then 'private, no-store' else 'private, max-age=31536000, immutable' end`,
        );
        s.setHeader(
          sql.lit`Content-Disposition`,
          sql`case
              when requested_file_version_can_inline then 'inline'
              else 'attachment'
            end || '; filename="' ||
            replace(
              replace(
                replace(requested_file_version.file_name, '"', ''),
                chr(10),
                ''
              ),
              chr(13),
              ''
            ) || '"'`,
        );
        s.returnBlob(sql`requested_file_version.blob_hash`);
      },
    });

    api.post("/files/spaces/{space_id:id}/items/upload", {
      query: [
        { name: "file_name", type: { type: "String", maxLength: 500 } },
        { name: "content_type", type: { type: "String", maxLength: 255 } },
        { name: "parent_id", type: { type: "String", maxLength: 30 } },
      ],
      blobBody: {
        scalar: "file_blob_hash",
        sizeScalar: "upload_size",
        maxSize: this.opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
        authorize: (s) => {
          this.authenticateApi(s, registration);
          s.if(
            sql`
              not (${this.blobUploadsEnabledSql(sql`space_id`)})
              or not (${
              this.canCreateFilePredicate(
                {
                  spaceId: sql`space_id`,
                  parentItemId: sql`try_cast(nullif(parent_id, '') as bigint)`,
                  sysUserId: sql`auth_user_id`,
                },
                { inlineSpaceAccess: true },
              )
            })
            `,
            (s) => {
              s.setHttpStatus(403);
              s.return(sql.lit`Not authorized`);
            },
          );
          s.if(sql`not (${this.validItemNameSql(sql`file_name`)})`, (s) => {
            s.setHttpStatus(400);
            s.return(sql.lit`Enter a valid file name`);
          });
          s.if(
            sql`try_cast(nullif(parent_id, '') as bigint) is not null
              and not exists (
                select 1
                from db.file_items upload_parent
                where upload_parent.id =
                    try_cast(nullif(parent_id, '') as bigint)
                  and upload_parent.file_space_id = space_id
                  and upload_parent.item_kind = 'folder'
                  and upload_parent.trashed_at is null
              )`,
            (s) => {
              s.setHttpStatus(400);
              s.return(sql.lit`The destination folder is unavailable`);
            },
          );
          s.if(sql`upload_size = 0`, (s) => {
            s.setHttpStatus(400);
            s.return(sql.lit`Empty file upload`);
          });
        },
      },
      procedure: (s) => {
        this.authenticateApi(s, registration);
        s.defScalar(
          "upload_parent_id",
          sql`try_cast(nullif(parent_id, '') as bigint)`,
        );
        // Authorization ran in the blob authorize stage; the stored
        // procedures re-run the name/parent/sibling validations.
        s.startTransaction();
        this.createFileItem(s, {
          spaceId: sql`space_id`,
          parentItemId: sql`upload_parent_id`,
          name: sql`file_name`,
          into: "uploaded_file_item_id",
        });
        this.createFileVersion(s, {
          itemId: sql`uploaded_file_item_id`,
          fileName: sql`trim(file_name)`,
          contentType:
            sql`coalesce(nullif(trim(content_type), ''), 'application/octet-stream')`,
          byteLength: sql`upload_size`,
          blobHash: sql`file_blob_hash`,
          sysUserId: sql`auth_user_id`,
          intoVersion: "uploaded_file_version_id",
        });
        s.commitTransaction();
        s.setHttpStatus(201);
        s.setHeader(sql.lit`Content-Type`, sql.lit`application/json`);
        s.return(sql`
          json_build_object(
            'success', true,
            'itemId', uploaded_file_item_id,
            'versionId', uploaded_file_version_id
          )
        `);
      },
    });

    api.post("/files/items/{item_id:id}/versions/upload", {
      query: [
        { name: "file_name", type: { type: "String", maxLength: 500 } },
        { name: "content_type", type: { type: "String", maxLength: 255 } },
        { name: "note", type: { type: "String", maxLength: 2000 } },
      ],
      blobBody: {
        scalar: "file_blob_hash",
        sizeScalar: "upload_size",
        maxSize: this.opts.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
        authorize: (s) => {
          this.authenticateApi(s, registration);
          s.defScalar(
            "version_upload_space_id",
            {
              expr:
                sql`(select file_space_id from db.file_items where id = item_id and item_kind = 'file')`,
              allowNoRead: true,
            },
          );
          s.defScalar(
            "version_upload_content_type",
            sql`lower(trim(coalesce(
              nullif(content_type, ''),
              'application/octet-stream'
            )))`,
          );
          s.if(
            sql`
              not (${
              this.blobUploadsEnabledSql(
                sql`version_upload_space_id`,
              )
            })
              or not (${
              this.canCreateVersionPredicate(
                {
                  spaceId: sql`version_upload_space_id`,
                  itemId: sql`item_id`,
                  sysUserId: sql`auth_user_id`,
                },
                { inlineSpaceAccess: true },
              )
            })
            `,
            (s) => {
              s.setHttpStatus(403);
              s.return(sql.lit`Not authorized`);
            },
          );
          s.if(sql`not (${this.validItemNameSql(sql`file_name`)})`, (s) => {
            s.setHttpStatus(400);
            s.return(sql.lit`Enter a valid file name`);
          });
          s.if(
            sql`exists (
              select 1
              from db.file_versions first_version
              where first_version.file_item_id = item_id
                and first_version.version_number = 1
                and lower(trim(first_version.content_type)) <>
                  version_upload_content_type
            )`,
            (s) => {
              s.setHttpStatus(400);
              s.return(
                sql.lit`A file's content type cannot change between versions`,
              );
            },
          );
          s.if(sql`upload_size = 0`, (s) => {
            s.setHttpStatus(400);
            s.return(sql.lit`Empty file upload`);
          });
        },
      },
      procedure: (s) => {
        this.authenticateApi(s, registration);
        s.defRecord(
          "version_upload_item",
          sql`
            select id, file_space_id
            from db.file_items
            where id = item_id
              and item_kind = 'file'
              and trashed_at is null
          `,
        );
        s.if(sql`version_upload_item.id is null`, (s) => {
          s.setHttpStatus(404);
          s.return(sql.lit`File not found`);
        });
        // Authorization ran in the blob authorize stage; the stored
        // procedure re-runs the version validations.
        s.startTransaction();
        this.createFileVersion(s, {
          itemId: sql`version_upload_item.id`,
          fileName: sql`trim(file_name)`,
          contentType:
            sql`coalesce(nullif(trim(content_type), ''), 'application/octet-stream')`,
          byteLength: sql`upload_size`,
          blobHash: sql`file_blob_hash`,
          note: sql`nullif(trim(note), '')`,
          sysUserId: sql`auth_user_id`,
          intoVersion: "uploaded_file_version_id",
        });
        s.commitTransaction();
        s.setHttpStatus(201);
        s.return(sql`
          json_build_object(
            'success', true,
            'itemId', version_upload_item.id,
            'versionId', uploaded_file_version_id
          )
        `);
      },
    });
    for (const extension of this.extensions) {
      extension.registerApi?.({
        api,
        registration,
        authenticate: (s) => this.authenticateApi(s, registration),
      });
    }
  }
}
