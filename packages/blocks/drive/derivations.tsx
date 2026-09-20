import { sql } from "std/sql_utils";
import type { Sql } from "std/sql_utils";
import type { GeneralServerStatements } from "std/statements";
import { system } from "std/system";
import type {
  DriveBlockContract,
  DriveExtension,
  FileVersionCreatedEvent,
} from "./types.ts";

/** SQL expressions available while building a processing request. */
export interface DriveDerivationRequestContext {
  sourceBlobHash: Sql;
  sourceName: Sql;
  sourcePath: Sql;
  inputCollection: Sql;
  dependencyBlobHash?: Sql;
}

export interface DriveDerivationInputCollectionDefinition {
  matches: (event: FileVersionCreatedEvent) => Sql;
}
/** One flat artifact published by a derivation operation. */
export interface DriveDerivedArtifactDefinition {
  name: string;
  contentType?: string;
  resultBlobHash: (serviceResult: Sql) => Sql;
  required?: boolean;
  serve?: boolean;
}

/** One immutable derived-blob recipe installed by `DriveDerivations`. */
export interface DriveDerivationDefinition {
  name: string;
  recipeVersion: number;
  operation: string;
  contentType?: string;
  matches: (event: FileVersionCreatedEvent) => Sql;
  requestJson: (context: DriveDerivationRequestContext) => Sql;
  resultBlobHash: (serviceResult: Sql) => Sql;
  outputs?: readonly DriveDerivedArtifactDefinition[];
  inputCollection?: DriveDerivationInputCollectionDefinition;
  dependency?: string;
  returnedDependencyBlobHash?: (serviceResult: Sql) => Sql;
  serve?: boolean;
  maxExecutionSeconds?: number;
}

export interface InstalledDriveDerivedArtifact {
  name: string;
  recipeVersion: number;
  contentType?: string;
  required: boolean;
  serve: boolean;
  owner: DriveDerivationDefinition;
  resultBlobHash: (serviceResult: Sql) => Sql;
}

function definitionArtifacts(
  definition: DriveDerivationDefinition,
): InstalledDriveDerivedArtifact[] {
  return [
    {
      name: definition.name,
      recipeVersion: definition.recipeVersion,
      contentType: definition.contentType,
      required: true,
      serve: definition.serve ?? false,
      owner: definition,
      resultBlobHash: definition.resultBlobHash,
    },
    ...(definition.outputs ?? []).map((artifact) => ({
      name: artifact.name,
      recipeVersion: definition.recipeVersion,
      contentType: artifact.contentType,
      required: artifact.required ?? true,
      serve: artifact.serve ?? false,
      owner: definition,
      resultBlobHash: artifact.resultBlobHash,
    })),
  ];
}

/** Adds background derived blobs to Drive without changing source versions. */
export class DriveDerivations implements DriveExtension {
  readonly name = "drive_derivations";
  readonly definitions: readonly DriveDerivationDefinition[];
  readonly artifacts: readonly InstalledDriveDerivedArtifact[];
  #files?: DriveBlockContract;

  constructor(definitions: readonly DriveDerivationDefinition[]) {
    if (definitions.length === 0) {
      throw new Error("DriveDerivations requires at least one definition.");
    }
    const definitionsByName = new Map<string, DriveDerivationDefinition>();
    const artifactsByName = new Map<string, InstalledDriveDerivedArtifact>();
    for (const definition of definitions) {
      if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
        throw new Error(
          `Drive derivation name "${definition.name}" must be snake_case.`,
        );
      }
      if (definitionsByName.has(definition.name)) {
        throw new Error(
          `Drive derivation "${definition.name}" is duplicated.`,
        );
      }
      if (
        !Number.isInteger(definition.recipeVersion) ||
        definition.recipeVersion < 1
      ) {
        throw new Error(
          `Drive derivation "${definition.name}" recipeVersion must be a positive integer.`,
        );
      }
      if (
        definition.dependency &&
        !definitionsByName.has(definition.dependency)
      ) {
        throw new Error(
          `Drive derivation "${definition.name}" dependency "${definition.dependency}" must be declared first.`,
        );
      }
      if (
        definition.returnedDependencyBlobHash && !definition.dependency
      ) {
        throw new Error(
          `Drive derivation "${definition.name}" cannot return a dependency blob without declaring a dependency.`,
        );
      }
      definitionsByName.set(definition.name, definition);
      for (const artifact of definitionArtifacts(definition)) {
        if (!/^[a-z][a-z0-9_]*$/.test(artifact.name)) {
          throw new Error(
            `Drive derivation artifact name "${artifact.name}" must be snake_case.`,
          );
        }
        if (artifactsByName.has(artifact.name)) {
          throw new Error(
            `Drive derivation artifact "${artifact.name}" is duplicated.`,
          );
        }
        artifactsByName.set(artifact.name, artifact);
      }
    }
    this.definitions = definitions;
    this.artifacts = [...artifactsByName.values()];
  }

  initialize(files: DriveBlockContract) {
    this.#files = files;
    system.enum_({
      name: "file_derivation_status",
      values: ["pending", "ready", "unavailable", "failed"],
    });
    system.db.table("file_derivations", (table) => {
      table.fk("source_file_version_id", files.versionTable).notNull()
        .onDelete("Cascade");
      table.string("derivation_type", 80).notNull();
      table.uint("recipe_version").notNull();
      table.string("content_type", 255);
      table.enum("status", "file_derivation_status").notNull();
      table.blobRef("blob_hash");
      table.string("error", 4000).multiline();
      table.unique([
        "source_file_version_id",
        "derivation_type",
        "recipe_version",
      ]);
      table.skipAutoApi();
    });

    this.#registerSeedReactor();
    for (const definition of this.definitions) {
      if (definition.inputCollection) {
        this.#registerInputRefreshReactor(definition);
      }
      this.#registerReactor(definition);
    }
  }

  registerApi: NonNullable<DriveExtension["registerApi"]> = ({
    api,
    authenticate,
  }) => {
    const files = this.#requiredFiles();
    for (const definition of this.artifacts) {
      if (!definition.serve) continue;
      api.get(
        `/files/versions/{version_id:id}/derivations/${definition.name}/${definition.recipeVersion}/{artifact_hash}`,
        {
          procedure: (s) => {
            authenticate(s);
            s.defRecord(
              "requested_derivation",
              sql`
                select derivation.blob_hash, derivation.content_type
                from db.file_derivations derivation
                join db.file_versions version
                  on version.id = derivation.source_file_version_id
                join db.file_items item on item.id = version.file_item_id
                join db.file_spaces space on space.id = item.file_space_id
                where derivation.source_file_version_id = version_id
                  and derivation.derivation_type = ${sql.lit(definition.name)}
                  and derivation.recipe_version = ${definition.recipeVersion}
                  and derivation.status = 'ready'
                  and regex.is_match(artifact_hash, '^[0-9a-f]{64}$')
                  and bytes.to_hex(derivation.blob_hash) = artifact_hash
                  and ${
                files.canReadVersionSql({
                  spaceRecord: sql`space`,
                  itemRecord: sql`item`,
                  versionRecord: sql`version`,
                  sysUserId: sql`auth_user_id`,
                })
              }
              `,
            );
            s.if(sql`requested_derivation.blob_hash is null`, (s) => {
              s.setHttpStatus(404);
              s.return(sql.lit`Derived file not found`);
            });
            s.setHeader(
              sql.lit`Content-Type`,
              sql`coalesce(
                requested_derivation.content_type,
                'application/octet-stream'
              )`,
            );
            s.setHeader(sql.lit`X-Content-Type-Options`, sql.lit`nosniff`);
            s.setHeader(
              sql.lit`Cache-Control`,
              sql.lit`private, max-age=31536000, immutable`,
            );
            s.setHeader(
              sql.lit`ETag`,
              sql`'"' || artifact_hash || '"'`,
            );
            s.returnBlob(sql`requested_derivation.blob_hash`);
          },
        },
      );
    }
  };

  registerStoredProcedures = () => {
    const files = this.#requiredFiles();
    system.storedProcedure({
      name: "files_retry_derivation",
      transaction: "standalone",
      inputScalars: [{ name: "p_derivation_id", type: "BigInt" }],
      procedure: (s) => {
        s.defRecord(
          "retry_derivation",
          sql`
            select
              derivation.id,
              derivation.source_file_version_id,
              derivation.derivation_type,
              derivation.recipe_version,
              derivation.status
            from db.file_derivations derivation
            join db.file_versions version
              on version.id = derivation.source_file_version_id
            join db.file_items item on item.id = version.file_item_id
            join db.file_spaces space on space.id = item.file_space_id
            where derivation.id = p_derivation_id
              and ${
            files.runtimeAccessSql(
              sql`space.id`,
              sql`current_user`,
              "write",
            )
          }
              and ${files.extensionEnabledSql(sql`space.id`, this.name)}
          `,
        );
        s.if(
          sql`retry_derivation.id is null`,
          (s) => s.throwError(sql.lit`This file derivation is unavailable.`),
        );
        s.if(
          sql`retry_derivation.status <> 'failed'`,
          (s) =>
            s.throwError(sql.lit`Only failed file derivations can be retried.`),
        );
        for (const definition of this.definitions) {
          const artifacts = definitionArtifacts(definition);
          s.if(
            sql`${
              sql.inList(
                sql`retry_derivation.derivation_type`,
                artifacts.map((artifact) => sql.lit(artifact.name)),
              )
            } and retry_derivation.recipe_version = ${definition.recipeVersion}`,
            (s) => {
              s.startTransaction();
              s.modify(sql`
                update db.file_derivations
                set status = 'pending', blob_hash = null, error = null
                where source_file_version_id =
                    retry_derivation.source_file_version_id
                  and ${
                sql.inList(
                  sql`derivation_type`,
                  artifacts.map((artifact) => sql.lit(artifact.name)),
                )
              }
                  and recipe_version = ${definition.recipeVersion}
                  and status in ('ready', 'failed')
              `);
              s.commitTransaction();
            },
          );
        }
      },
    });
  };

  blobUrl(
    fileVersionId: Sql,
    definition: { name: string; recipeVersion: number },
    artifactHash: Sql,
  ): Sql {
    this.#assertArtifact(definition);
    return sql`
      '/api/files/versions/' || cast(${fileVersionId} as string)
      || '/derivations/'
      || ${sql.lit(definition.name)} || '/'
      || cast(${definition.recipeVersion} as string)
      || '/' || ${artifactHash}
    `;
  }

  #registerSeedReactor() {
    const files = this.#requiredFiles();
    const event: FileVersionCreatedEvent = {
      spaceId: sql`space.id`,
      itemId: sql`item.id`,
      versionId: sql`version.id`,
      versionNumber: sql`version.version_number`,
      fileName: sql`version.file_name`,
      contentType: sql`version.content_type`,
      byteLength: sql`version.byte_length`,
      sysUserId: sql`version.created_by_user_id`,
    };
    const candidates = sql.unionAll(
      ...this.definitions.flatMap((definition) =>
        definitionArtifacts(definition).map((artifact) =>
          sql`
          select
            version.id as source_file_version_id,
            ${sql.lit(artifact.name)} as derivation_type,
            ${definition.recipeVersion} as recipe_version,
            ${
            artifact.contentType
              ? sql.lit(artifact.contentType)
              : sql`cast(null as string)`
          } as content_type
          from db.file_versions version
          join db.file_items item on item.id = version.file_item_id
          join db.file_spaces space on space.id = item.file_space_id
          where item.current_file_version_id = version.id
            and ${definition.matches(event)}
            and ${files.extensionEnabledSql(sql`space.id`, this.name)}
            and not exists (
              select 1
              from db.file_derivations derivation
              where derivation.source_file_version_id = version.id
                and derivation.derivation_type = ${sql.lit(artifact.name)}
                and derivation.recipe_version = ${definition.recipeVersion}
            )
        `
        )
      ),
    );
    system.addReactor({
      name: "file_derivation_seed",
      query: candidates,
      resultTable: "file_derivation_seed_candidates",
      maxExecutionSeconds: 30,
      procedure: (s) => {
        s.startTransaction();
        s.modify(sql`
          insert into db.file_derivations (
            source_file_version_id,
            derivation_type,
            recipe_version,
            content_type,
            status
          ) select
            source_file_version_id,
            derivation_type,
            recipe_version,
            content_type,
            'pending'
          from file_derivation_seed_candidates
          on conflict (
            source_file_version_id,
            derivation_type,
            recipe_version
          ) do nothing
        `);
        s.commitTransaction();
      },
    });
  }

  #registerReactor(definition: DriveDerivationDefinition) {
    const dependency = definition.dependency
      ? this.definitions.find((candidate) =>
        candidate.name === definition.dependency
      )
      : undefined;
    system.addReactor({
      name: `file_derivation_${definition.name}`,
      query: sql`
        ${
        definition.inputCollection
          ? this.#fileTreeCte("derivation_file_tree")
          : sql``
      }
        select
          derivation.id,
          derivation.source_file_version_id,
          version.file_name,
          source.blob_hash as source_blob_hash,
          ${
        definition.inputCollection
          ? sql`source_tree.relative_path`
          : sql`version.file_name`
      } as source_relative_path,
          ${
        definition.inputCollection
          ? this.#inputCollectionJson(
            definition.inputCollection,
            "derivation_file_tree",
            sql`source_item.file_space_id`,
            sql`derivation.source_file_version_id`,
            sql`source_tree.root_file_item_id`,
            sql`source_tree.parent_file_item_id`,
          )
          : sql`'[]'::json`
      } as input_collection_json
          ${
        dependency
          ? sql`, dependency.id as dependency_id,
                  dependency.status as dependency_status,
                  dependency.blob_hash as dependency_blob_hash,
                  dependency.error as dependency_error`
          : sql``
      }
        from db.file_derivations derivation
        join db.file_versions version
          on version.id = derivation.source_file_version_id
        ${
        definition.inputCollection
          ? sql`join db.file_items source_item
              on source_item.id = version.file_item_id`
          : sql``
      }
        join db.file_version_blobs source
          on source.file_version_id = version.id
        ${
        definition.inputCollection
          ? sql`join derivation_file_tree source_tree
              on source_tree.file_item_id = source_item.id`
          : sql``
      }
        ${
        dependency
          ? sql`join db.file_derivations dependency
              on dependency.source_file_version_id =
                derivation.source_file_version_id
              and dependency.derivation_type = ${sql.lit(dependency.name)}
              and dependency.recipe_version = ${dependency.recipeVersion}`
          : sql``
      }
        where derivation.derivation_type = ${sql.lit(definition.name)}
          and derivation.recipe_version = ${definition.recipeVersion}
          and derivation.status = 'pending'
          ${
        dependency ? sql`and dependency.status in ('ready', 'failed')` : sql``
      }
      `,
      recordName: "file_derivation_candidate",
      maxConcurrent: 1,
      maxExecutionSeconds: definition.maxExecutionSeconds ?? 600,
      procedure: (s) => {
        if (dependency) {
          s.if(
            sql`file_derivation_candidate.dependency_status = 'failed'`,
            (s) => {
              const artifacts = definitionArtifacts(definition);
              s.startTransaction();
              s.modify(sql`
                update db.file_derivations
                set status = 'failed',
                    error = left(
                      ${sql.lit(`Dependency ${dependency.name} failed: `)} ||
                      coalesce(file_derivation_candidate.dependency_error, ''),
                      4000
                    )
                where source_file_version_id =
                    file_derivation_candidate.source_file_version_id
                  and ${
                sql.inList(
                  sql`derivation_type`,
                  artifacts.map((artifact) => sql.lit(artifact.name)),
                )
              }
                  and recipe_version = ${definition.recipeVersion}
                  and status = 'pending'
              `);
              s.commitTransaction();
            },
          ).else((s) => this.#derive(s, definition, dependency));
        } else {
          this.#derive(s, definition, undefined);
        }
      },
    });
  }

  #derive(
    s: GeneralServerStatements,
    definition: DriveDerivationDefinition,
    dependency: DriveDerivationDefinition | undefined,
  ) {
    const requestContext: DriveDerivationRequestContext = {
      sourceBlobHash: sql`file_derivation_candidate.source_blob_hash`,
      sourceName: sql`file_derivation_candidate.file_name`,
      sourcePath: sql`file_derivation_candidate.source_relative_path`,
      inputCollection: sql`file_derivation_candidate.input_collection_json`,
      dependencyBlobHash: dependency
        ? sql`file_derivation_candidate.dependency_blob_hash`
        : undefined,
    };
    s.serviceRequest({
      serviceType: sql.lit`processing`,
      operation: sql.lit(definition.operation),
      optIn: true,
      requestJson: definition.requestJson(requestContext),
      defResultJsonScalar: "file_derivation_response",
      defErrorJsonScalar: "file_derivation_service_error",
    });
    const serviceResult = sql`
      (file_derivation_response::json)->'resultJson'
    `;
    const artifacts = definitionArtifacts(definition);
    const artifactHashes = artifacts.map((artifact) => ({
      artifact,
      hash: artifact.resultBlobHash(serviceResult),
    }));
    const returnedDependencyBlobHash = definition.returnedDependencyBlobHash
      ? definition.returnedDependencyBlobHash(serviceResult)
      : undefined;
    const success = sql.and(
      sql`file_derivation_service_error is null`,
      ...artifactHashes
        .filter(({ artifact }) => artifact.required)
        .map(({ hash }) =>
          sql`${hash} is not null
            and regex.is_match(${hash}, '^[0-9a-f]{64}$')`
        ),
      ...(returnedDependencyBlobHash
        ? [
          sql`${returnedDependencyBlobHash} is not null
            and regex.is_match(
              ${returnedDependencyBlobHash},
              '^[0-9a-f]{64}$'
            )`,
        ]
        : []),
    );
    s.if(success, (s) => {
      s.startTransaction();
      if (dependency && returnedDependencyBlobHash) {
        s.if(
          sql`${returnedDependencyBlobHash} is not null
            and regex.is_match(
              ${returnedDependencyBlobHash},
              '^[0-9a-f]{64}$'
            )
            and bytes.from_hex(${returnedDependencyBlobHash}) <>
              file_derivation_candidate.dependency_blob_hash`,
          (s) => {
            s.modify(sql`
              update db.file_derivations
              set blob_hash = bytes.from_hex(${returnedDependencyBlobHash})
              where id = file_derivation_candidate.dependency_id
                and status = 'ready'
                and blob_hash =
                  file_derivation_candidate.dependency_blob_hash
            `);
          },
        );
      }
      for (const { artifact, hash } of artifactHashes) {
        if (artifact.required) {
          s.modify(sql`
            update db.file_derivations
            set status = 'ready',
                blob_hash = bytes.from_hex(${hash}),
                error = null
            where source_file_version_id =
                file_derivation_candidate.source_file_version_id
              and derivation_type = ${sql.lit(artifact.name)}
              and recipe_version = ${definition.recipeVersion}
              and status = 'pending'
          `);
        } else {
          s.if(
            sql`${hash} is not null
              and regex.is_match(${hash}, '^[0-9a-f]{64}$')`,
            (s) => {
              s.modify(sql`
                update db.file_derivations
                set status = 'ready',
                    blob_hash = bytes.from_hex(${hash}),
                    error = null
                where source_file_version_id =
                    file_derivation_candidate.source_file_version_id
                  and derivation_type = ${sql.lit(artifact.name)}
                  and recipe_version = ${definition.recipeVersion}
                  and status = 'pending'
              `);
            },
          ).else((s) => {
            s.modify(sql`
              update db.file_derivations
              set status = 'unavailable',
                  blob_hash = null,
                  error = 'This optional representation is not available.'
              where source_file_version_id =
                  file_derivation_candidate.source_file_version_id
                and derivation_type = ${sql.lit(artifact.name)}
                and recipe_version = ${definition.recipeVersion}
                and status = 'pending'
            `);
          });
        }
      }
      s.commitTransaction();
    }).else((s) => {
      s.startTransaction();
      s.modify(sql`
        update db.file_derivations
        set status = 'failed',
            blob_hash = null,
            error = left(coalesce(
              cast(file_derivation_service_error as string),
              ${
        sql.lit(
          `Processing returned an invalid ${definition.name} blob reference`,
        )
      }
            ), 4000)
        where source_file_version_id =
            file_derivation_candidate.source_file_version_id
          and ${
        sql.inList(
          sql`derivation_type`,
          artifacts.map((artifact) => sql.lit(artifact.name)),
        )
      }
          and recipe_version = ${definition.recipeVersion}
          and status = 'pending'
      `);
      s.commitTransaction();
    });
  }

  #registerInputRefreshReactor(definition: DriveDerivationDefinition) {
    const artifacts = definitionArtifacts(definition);
    // Existing transaction history is the refresh cursor. Compare file changes
    // with the last pending transition, not completion: changes during processing
    // must cause another pass. Conservatively refresh the current drawings in the
    // file space; historical source versions keep their completed artifacts.
    system.addReactor({
      name: `file_derivation_${definition.name}_input_refresh`,
      query: sql`
        with candidates as materialized (
          select derivation.id, derivation.source_file_version_id,
            source_item.file_space_id
          from db.file_derivations derivation
          join db.file_versions source_version
            on source_version.id = derivation.source_file_version_id
          join db.file_items source_item
            on source_item.id = source_version.file_item_id
          where derivation.derivation_type = ${sql.lit(definition.name)}
            and derivation.recipe_version = ${definition.recipeVersion}
            and derivation.status in ('ready', 'failed', 'unavailable')
            and source_item.current_file_version_id = source_version.id
            and source_item.trashed_at is null
        ), last_pending as materialized (
          select preparation.record_id, max(preparation.tx_id) as tx_id
          from db.file_derivations__versions preparation
          where preparation.file_derivations__status = 'pending'
            and preparation.record_id in (select id from candidates)
          group by preparation.record_id
        ), change_history as materialized (
          select change.tx_id, change.record_id
          from db.file_items__versions change
          -- Filter history before looking up current file items. Older changes
          -- cannot refresh any candidate and must not repeat those lookups.
          where change.tx_id > (select min(tx_id) from last_pending)
            and (
              change.op_kind = 'insert'
              or change.file_items__name__set
              or change.file_items__parent_file_item_id__set
              or change.file_items__trashed_at__set
              or change.file_items__current_file_version_id__set
            )
        ), last_file_change as materialized (
          select changed_item.file_space_id, max(change.tx_id) as tx_id
          from change_history change
          join db.file_items changed_item
            on changed_item.id = change.record_id
          where changed_item.file_space_id in (
            select file_space_id from candidates
          )
          group by changed_item.file_space_id
        )
        select candidates.source_file_version_id
        from candidates
        join last_pending on last_pending.record_id = candidates.id
        join last_file_change
          on last_file_change.file_space_id = candidates.file_space_id
        where last_file_change.tx_id > last_pending.tx_id
      `,
      recordName: "file_derivation_input_refresh_candidate",
      maxExecutionSeconds: 30,
      procedure: (s) => {
        s.startTransaction();
        s.modify(sql`
          update db.file_derivations
          set status = 'pending', blob_hash = null, error = null
          where source_file_version_id =
              file_derivation_input_refresh_candidate.source_file_version_id
            and exists (
              select 1 from db.file_items current_source
              where current_source.current_file_version_id =
                file_derivation_input_refresh_candidate.source_file_version_id
                and current_source.trashed_at is null
            )
            and ${
          sql.inList(
            sql`derivation_type`,
            artifacts.map((artifact) => sql.lit(artifact.name)),
          )
        }
            and recipe_version = ${definition.recipeVersion}
            and status in ('ready', 'failed', 'unavailable')
        `);
        s.commitTransaction();
      },
    });
  }

  #fileTreeCte(name: string): Sql {
    const tree = sql.ref(name);
    return sql`
      with recursive ${tree} (
        file_space_id,
        file_item_id,
        root_file_item_id,
        parent_file_item_id,
        item_kind,
        relative_path,
        current_file_version_id,
        depth
      ) as (
        select
          root.file_space_id,
          root.id as file_item_id,
          root.id as root_file_item_id,
          root.parent_file_item_id,
          root.item_kind,
          root.name,
          root.current_file_version_id,
          1
        from db.file_items root
        where root.parent_file_item_id is null
          and root.trashed_at is null

        union all

        select
          child.file_space_id,
          child.id as file_item_id,
          parent.root_file_item_id as root_file_item_id,
          child.parent_file_item_id,
          child.item_kind,
          parent.relative_path || '/' || child.name,
          child.current_file_version_id,
          parent.depth + 1
        from ${tree} parent
        join db.file_items child
          on child.file_space_id = parent.file_space_id
          and child.parent_file_item_id = parent.file_item_id
        where child.trashed_at is null
          and parent.depth < 32
      )
    `;
  }

  #inputCollectionJson(
    collection: DriveDerivationInputCollectionDefinition,
    treeName: string,
    sourceSpaceId: Sql,
    sourceVersionId: Sql,
    sourceRootItemId: Sql,
    sourceParentItemId: Sql,
  ): Sql {
    const tree = sql.ref(treeName);
    // A top-level folder is the implicit package boundary. Root-level sources
    // retain whole-space discovery so flat eTransmit uploads still work.
    const event: FileVersionCreatedEvent = {
      spaceId: sql`package_item.file_space_id`,
      itemId: sql`package_item.id`,
      versionId: sql`package_version.id`,
      versionNumber: sql`package_version.version_number`,
      fileName: sql`package_version.file_name`,
      contentType: sql`package_version.content_type`,
      byteLength: sql`package_version.byte_length`,
      sysUserId: sql`package_version.created_by_user_id`,
    };
    return sql`coalesce((
      select json_array_agg(json_build_object(
        'filePath', package_tree.relative_path,
        'blobHash', bytes.to_hex(package_blob.blob_hash)
      ) order by
        lower(package_tree.relative_path),
        package_tree.relative_path,
        package_version.id)
      from ${tree} package_tree
      join db.file_items package_item
        on package_item.id = package_tree.file_item_id
      join db.file_versions package_version
        on package_version.id = package_tree.current_file_version_id
      join db.file_version_blobs package_blob
        on package_blob.file_version_id = package_version.id
      where package_tree.file_space_id = ${sourceSpaceId}
        and (
          ${sourceParentItemId} is null
          or package_tree.root_file_item_id = ${sourceRootItemId}
        )
        and package_tree.item_kind = 'file'
        and package_item.id <> (
          select file_item_id from db.file_versions
          where id = ${sourceVersionId}
        )
        and ${collection.matches(event)}
    ), '[]'::json)`;
  }

  #assertArtifact(definition: { name: string; recipeVersion: number }) {
    if (
      !this.artifacts.some((artifact) =>
        artifact.name === definition.name &&
        artifact.recipeVersion === definition.recipeVersion
      )
    ) {
      throw new Error(
        `Drive derivation "${definition.name}" is not installed by this extension.`,
      );
    }
  }

  #requiredFiles() {
    if (!this.#files) {
      throw new Error("DriveDerivations must be initialized before use.");
    }
    return this.#files;
  }
}
