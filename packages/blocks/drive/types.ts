import type { Node } from "std/ui";
import type { TableBuilder } from "std/system";
import type { Sql } from "std/sql_utils";
import type { DomStatements, ServerStatementsBase } from "std/statements";
import type { EndpointStatements } from "std/statements";
import type { Api } from "std/api";

export type FileAccessLevel = "viewer" | "editor" | "manager";
export type DriveItemOrdering = "name" | "custom";
export type DriveAccessVerb = "read" | "write" | "manage";

export interface DriveGrantConfig {
  users: boolean;
  permissions: boolean;
}

export interface DriveSpaceAccess {
  read: (
    spaceRecord: Sql,
    bindingRecord: Sql,
    sysUserId: Sql,
  ) => Sql;
  write?: (
    spaceRecord: Sql,
    bindingRecord: Sql,
    sysUserId: Sql,
  ) => Sql;
  /** Defaults to `write` when omitted. */
  manage?: (
    spaceRecord: Sql,
    bindingRecord: Sql,
    sysUserId: Sql,
  ) => Sql;
}

export interface DriveSpaceType {
  /** Stable machine name stored in `file_spaces.space_type`. */
  name: string;
  displayName?: string;
  /**
   * Additive table that owns domain foreign keys for a record-bound type.
   * Standalone types omit both `tableName` and `define`.
   */
  tableName?: string;
  /** Adds domain fields. Drive adds a unique `file_space_id`. */
  define?: (table: TableBuilder) => void;
  itemOrdering: DriveItemOrdering;
  /** Defaults to true. Disable for representation-only spaces. */
  blobUploads?: boolean;
  /** Optional version lifecycle such as controlled proposal/review/publication. */
  lifecycle?: DriveLifecycle;
  extensions: readonly DriveExtension[];
  /**
   * Explicit access policy for this type. A standalone type receives the
   * space record as both the first and second callback arguments.
   */
  access: DriveSpaceAccess;
  /** Enables the corresponding direct-grant tables and UI for this type. */
  grants?: Partial<DriveGrantConfig>;
  /** Stores an owner on spaces of this type for `driveSpaceOwner` policies. */
  owner?: boolean;
  /** Standalone-space creation policy. Omitted means code-created only. */
  canCreate?: (sysUserId: Sql) => Sql;
}

export interface FileVersionCreatedEvent {
  spaceId: Sql;
  itemId: Sql;
  versionId: Sql;
  versionNumber: Sql;
  fileName: Sql;
  contentType: Sql;
  byteLength: Sql;
  sysUserId: Sql;
}

export interface FileVersionAccessContext {
  spaceRecord: Sql;
  itemRecord: Sql;
  versionRecord: Sql;
  sysUserId: Sql;
}

export interface FileCreateAccessContext {
  spaceId: Sql;
  parentItemId: Sql;
  sysUserId: Sql;
}

export interface FileVersionCreateAccessContext {
  spaceId: Sql;
  itemId: Sql;
  sysUserId: Sql;
}

export interface FileItemUpdateAccessContext {
  spaceId: Sql;
  itemId: Sql;
  sysUserId: Sql;
}

export interface DriveExtension {
  name: string;
  initialize: (files: DriveBlockContract) => void;
  validate?: (files: DriveBlockContract) => void;
  onVersionCreated?: (
    s: ServerStatementsBase<any>,
    event: FileVersionCreatedEvent,
  ) => void;
  /**
   * Narrows read access for versions governed by this extension. The
   * predicate is composed with the space's viewer access everywhere Drive
   * lists, renders, or serves bytes.
   */
  canReadVersion?: (context: FileVersionAccessContext) => Sql;
  /**
   * Grants only creation of a file in a specific location. It does not grant
   * folder creation or any mutation of existing items.
   */
  canCreateFile?: (context: FileCreateAccessContext) => Sql;
  /**
   * Grants only creation of a new immutable version for a specific file.
   * It does not grant rename, move, trash, tag, or other Drive mutations.
   */
  canCreateVersion?: (context: FileVersionCreateAccessContext) => Sql;
  /**
   * Grants only file name and description updates. It does not grant move,
   * trash, version creation, or other Drive mutations.
   */
  canUpdateItemMetadata?: (context: FileItemUpdateAccessContext) => Sql;
  registerApi?: (context: {
    api: Api;
    registration: DriveApiRegistration;
    authenticate: (s: EndpointStatements) => void;
  }) => void;
  /**
   * Registers this extension's stored procedures. Called once per system from
   * DriveBlock.populate(), after every extension and publication consumer is
   * registered, so procedure bodies may fan out to late-registered consumers.
   */
  registerStoredProcedures?: (files: DriveBlockContract) => void;
  viewer?: FileViewerContribution;
}

/** A workflow extension that owns the version lifecycle for every file. */
export interface DriveLifecycle extends DriveExtension {
  readonly kind: "lifecycle";
}

export interface FileViewerRenderProps {
  fileSpaceId: Sql;
  fileItemId: Sql;
  fileVersionId: Sql;
  versionNumber: Sql;
  fileName: Sql;
  contentType: Sql;
  fileUrl: Sql;
  height?: string;
  readOnly: Sql;
  allowNewVersionFromHistorical: Sql;
  presentation: "default" | "governed";
  workspace: boolean;
  workspaceHandle?: Sql | string;
  initialPdfPage?: Sql;
  initialPdfFocus?: Sql;
  initialCadObjectKey?: Sql;
  documentHref?: FileViewerDocumentHref;
  onWorkspaceFileChange?: (
    s: DomStatements,
    fileItemId: Sql,
    fileVersionId: Sql,
  ) => void;
}

export interface FileViewerDocumentHref {
  prefix: string;
  suffix?: string;
  /** Defaults to the immutable version id for backwards compatibility. */
  id?: "item" | "version";
}

export interface FileViewerContribution {
  name: string;
  canView: (fileVersionRecord: Sql) => Sql;
  render: (props: FileViewerRenderProps) => Node;
  /**
   * Optional display-only rendering used when the surface is statically
   * read-only, so full editor trees are not emitted for reader pages.
   */
  renderReadOnly?: (
    props: Omit<
      FileViewerRenderProps,
      "readOnly" | "allowNewVersionFromHistorical"
    >,
  ) => Node;
}

export interface RegisteredFileViewer extends FileViewerContribution {
  extensionName: string;
  spaceTypeNames: string[];
}

export interface DriveBlockContract {
  readonly spaceTable: string;
  readonly itemTable: string;
  readonly versionTable: string;
  readonly versionBlobTable: string;
  readonly tagTable: string;
  readonly tagAssignmentTable: string;
  readonly spaceTypes: readonly DriveSpaceType[];
  readonly viewers: readonly RegisteredFileViewer[];
  readonly hasUserGrants: boolean;
  readonly hasPermissionGrants: boolean;
  readonly opts: DriveBlockOpts;
  itemOrderSql(itemRecord: Sql, customOrdering: Sql): Sql;
  customOrderingSql(spaceId: Sql): Sql;
  extensionEnabledSql(spaceId: Sql, extensionName: string): Sql;
  extensionEnabledForTypeSql(spaceType: Sql, extensionName: string): Sql;
  canCreateSpaceSql(spaceType: DriveSpaceType, sysUserId: Sql): Sql;
  accessSql(
    spaceType: DriveSpaceType,
    spaceId: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql;
  runtimeAccessSql(
    spaceId: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql;
  accessForSpaceRecordSql(
    spaceRecord: Sql,
    sysUserId: Sql,
    verb: DriveAccessVerb,
  ): Sql;
  canReadVersionSql(context: FileVersionAccessContext): Sql;
  /** The caller must independently prove read access to context.spaceRecord. */
  canReadVersionForAuthorizedSpaceSql(
    context: FileVersionAccessContext,
  ): Sql;
  canCreateFileSql(context: FileCreateAccessContext): Sql;
  canCreateVersionSql(context: FileVersionCreateAccessContext): Sql;
  canUpdateItemMetadataSql(context: FileItemUpdateAccessContext): Sql;
  versionBlobUrl(versionId: Sql, blobHash?: Sql): Sql;
  createFileVersion<T extends ServerStatementsBase<any>>(
    s: T,
    opts: CreateFileVersionOpts,
  ): void;
  createFileItem<T extends ServerStatementsBase<any>>(
    s: T,
    opts: CreateFileItemOpts,
  ): void;
  createSpace<T extends ServerStatementsBase<any>>(
    s: T,
    opts: CreateSpaceOpts,
  ): void;
  moveItem<T extends ServerStatementsBase<any>>(
    s: T,
    opts: MoveFileItemOpts,
  ): void;
  updateItemMetadata<T extends ServerStatementsBase<any>>(
    s: T,
    opts: UpdateFileItemMetadataOpts,
  ): void;
}

export interface DriveApiRegistration {
  domain: string;
  cookieName: Sql;
}

export interface DriveBlockOpts {
  spaceTypes: readonly DriveSpaceType[];
  maxUploadBytes?: number;
  /** Defaults to true. Disable only when the runtime constraint is unavailable. */
  enforceSiblingNameConstraint?: boolean;
}

export interface EnsureBoundSpaceOpts {
  type: DriveSpaceType;
  values: Record<string, Sql>;
  name: Sql;
  description?: Sql;
  into?: string;
}

export interface CreateSpaceOpts {
  type: DriveSpaceType;
  name: Sql;
  description?: Sql;
  sysUserId: Sql;
  into?: string;
}

export interface CreateFolderOpts {
  spaceId: Sql;
  parentItemId?: Sql;
  name: Sql;
  into?: string;
}

export interface CreateFileVersionOpts {
  itemId: Sql;
  fileName: Sql;
  contentType: Sql;
  byteLength: Sql;
  blobHash?: Sql;
  note?: Sql;
  sysUserId: Sql;
  intoVersion?: string;
}

export interface CreateFileItemOpts {
  spaceId: Sql;
  parentItemId?: Sql;
  name: Sql;
  description?: Sql;
  into: string;
}

export interface MoveFileItemOpts {
  spaceId: Sql;
  itemId: Sql;
  destinationParentItemId: Sql;
  sysUserId: Sql;
}

export interface UpdateFileItemMetadataOpts {
  spaceId: Sql;
  itemId: Sql;
  name: Sql;
  description: Sql;
  sysUserId: Sql;
}
