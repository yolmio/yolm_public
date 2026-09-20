import { Button } from "components/button";
import { ButtonGroup } from "components/button_group";
import { Cad2dViewer, focusCad2dViewerObject } from "components/cad_2d_viewer";
import { focusGlbViewerObject, GlbViewer } from "components/glb_viewer";
import { Typography } from "components/typography";
import { Data } from "std/data";
import { type Sql, sql } from "std/sql_utils";
import { Show, useUniqueId } from "std/ui";
import type { Node } from "std/ui";
import {
  dstvViewerGlbArtifact,
  dstvViewerSceneArtifact,
  dwgViewerGlbArtifact,
  dwgViewerSceneArtifact,
  dxfViewerSceneArtifact,
  ifcViewerGlbArtifact,
  solidworksViewerGlbArtifact,
  stepViewerGlbArtifact,
} from "./cad_artifacts";
import type { CadArtifactReference, FabCadFormat } from "./cad_artifacts";
import type { DriveDerivations } from "./derivations";
import type {
  DriveExtension,
  FileViewerContribution,
  FileViewerRenderProps,
} from "./types";

export interface CadViewerExtensionOptions {
  derivations: DriveDerivations;
  glbModuleAssetUrl?: string;
  cad2dModuleAssetUrl?: string;
  canView?: (fileVersionRecord: Sql) => Sql;
}

function formatMatches(format: FabCadFormat, version: Sql): Sql {
  switch (format) {
    case "step":
      return sql`${version}.name ilike '%.step'
        or ${version}.name ilike '%.stp'
        or trim(${version}.content_type) ilike 'application/step'
        or trim(${version}.content_type) ilike 'model/step'`;
    case "solidworks":
      return sql`${version}.name ilike '%.sldprt'
        or ${version}.name ilike '%.sldasm'
        or trim(${version}.content_type) ilike 'application/sldworks'
        or trim(${version}.content_type) ilike 'application/vnd.solidworks.part'
        or trim(${version}.content_type) ilike 'application/vnd.solidworks.assembly'`;
    case "ifc":
      return sql`${version}.name ilike '%.ifc'
        or ${version}.name ilike '%.ifczip'
        or trim(${version}.content_type) ilike 'application/ifc'
        or trim(${version}.content_type) ilike 'model/ifc'`;
    case "dwg":
      return sql`${version}.name ilike '%.dwg'
        or trim(${version}.content_type) ilike 'application/acad'
        or trim(${version}.content_type) ilike 'application/dwg'
        or trim(${version}.content_type) ilike 'image/vnd.dwg'`;
    case "dxf":
      return sql`${version}.name ilike '%.dxf'
        or trim(${version}.content_type) ilike 'application/dxf'
        or trim(${version}.content_type) ilike 'image/vnd.dxf'`;
    case "dstv":
      return sql`${version}.name ilike '%.nc1'
        or ${version}.name ilike '%.nc'
        or trim(${version}.content_type) ilike 'application/vnd.dstv'
        or trim(${version}.content_type) ilike 'text/vnd.dstv'`;
  }
}

function fileFormatMatches(
  format: FabCadFormat,
  fileName: Sql,
  contentType: Sql,
): Sql {
  switch (format) {
    case "step":
      return sql`${fileName} ilike '%.step'
        or ${fileName} ilike '%.stp'
        or trim(${contentType}) ilike 'application/step'
        or trim(${contentType}) ilike 'model/step'`;
    case "solidworks":
      return sql`${fileName} ilike '%.sldprt'
        or ${fileName} ilike '%.sldasm'
        or trim(${contentType}) ilike 'application/sldworks'
        or trim(${contentType}) ilike 'application/vnd.solidworks.part'
        or trim(${contentType}) ilike 'application/vnd.solidworks.assembly'`;
    case "ifc":
      return sql`${fileName} ilike '%.ifc'
        or ${fileName} ilike '%.ifczip'
        or trim(${contentType}) ilike 'application/ifc'
        or trim(${contentType}) ilike 'model/ifc'`;
    case "dwg":
      return sql`${fileName} ilike '%.dwg'
        or trim(${contentType}) ilike 'application/acad'
        or trim(${contentType}) ilike 'application/dwg'
        or trim(${contentType}) ilike 'image/vnd.dwg'`;
    case "dxf":
      return sql`${fileName} ilike '%.dxf'
        or trim(${contentType}) ilike 'application/dxf'
        or trim(${contentType}) ilike 'image/vnd.dxf'`;
    case "dstv":
      return sql`${fileName} ilike '%.nc1'
        or ${fileName} ilike '%.nc'
        or trim(${contentType}) ilike 'application/vnd.dstv'
        or trim(${contentType}) ilike 'text/vnd.dstv'`;
  }
}

function cadFileCanView(version: Sql) {
  return sql`(${formatMatches("step", version)})
    or (${formatMatches("solidworks", version)})
    or (${formatMatches("ifc", version)})
    or (${formatMatches("dwg", version)})
    or (${formatMatches("dxf", version)})
    or (${formatMatches("dstv", version)})`;
}

function viewerHandle(workspaceHandle: Sql | string | undefined) {
  if (typeof workspaceHandle === "string") return `${workspaceHandle}-cad`;
  if (workspaceHandle) return sql`${workspaceHandle} || '-cad'`;
  return undefined;
}

function artifactStatus(
  fileVersionId: Sql,
  artifact: CadArtifactReference,
): Sql {
  return sql`(
    select json_build_object(
      'status', derivation.status,
      'error', derivation.error,
      'blobHash', case
        when derivation.blob_hash is null then null
        else bytes.to_hex(derivation.blob_hash)
      end
    )
    from db.file_derivations derivation
    where derivation.source_file_version_id = ${fileVersionId}
      and derivation.derivation_type = ${sql.lit(artifact.name)}
      and derivation.recipe_version = ${artifact.recipeVersion}
  )`;
}

function PendingArtifact(props: { status: Sql; label: string }) {
  return (
    <div className="m-auto max-w-lg p-6 text-center">
      <Typography level="title-md">{props.label} is not ready</Typography>
      <Typography level="body-sm" color="neutral" className="mt-1">
        {sql`coalesce(
          ${props.status}->>'error',
          case ${props.status}->>'status'
            when 'unavailable' then 'This representation is unavailable.'
            when 'failed' then 'Preparation failed.'
            else 'The view is still being prepared.'
          end
        )`}
      </Typography>
      <Button className="mt-4" onClick={(s) => s.refetch()}>
        Refresh
      </Button>
    </div>
  );
}

function GlbArtifactViewer(props: {
  driveProps: FileViewerRenderProps;
  options: CadViewerExtensionOptions;
  artifact: CadArtifactReference;
  handle: Sql;
  objectKey: Sql;
  status: Sql;
  browserLabel?: string;
  toolbarLeading?: Node;
}) {
  const sceneUrl = props.options.derivations.blobUrl(
    props.driveProps.fileVersionId,
    props.artifact,
    sql`(cast(${props.status} as json)->>'blobHash')`,
  );
  return (
    <Show
      when={sql`${props.status}->>'status' = 'ready'`}
      fallback={<PendingArtifact status={props.status} label="3D view" />}
    >
      <GlbViewer
        handle={props.handle}
        moduleAssetUrl={props.options.glbModuleAssetUrl}
        fileUrl={sceneUrl}
        fileName={sql`${props.driveProps.fileName} || '.glb'`}
        height="100%"
        className="min-h-0 grow border-0"
        initialEdges
        showModelTree={false}
        browserLabel={props.browserLabel}
        toolbarLeading={props.toolbarLeading}
        onReady={(s) => {
          s.if(sql`trim(${props.objectKey}) <> ''`, (s) => {
            focusGlbViewerObject(s, props.handle, props.objectKey);
          });
        }}
      />
    </Show>
  );
}

function SceneArtifactViewer(props: {
  driveProps: FileViewerRenderProps;
  options: CadViewerExtensionOptions;
  artifact: CadArtifactReference;
  format: "dwg" | "dxf" | "dstv";
  handle: Sql;
  objectKey: Sql;
  status: Sql;
  toolbarLeading?: Node;
}) {
  const sceneUrl = props.options.derivations.blobUrl(
    props.driveProps.fileVersionId,
    props.artifact,
    sql`(cast(${props.status} as json)->>'blobHash')`,
  );
  return (
    <Show
      when={sql`${props.status}->>'status' = 'ready'`}
      fallback={<PendingArtifact status={props.status} label="2D view" />}
    >
      <Cad2dViewer
        handle={props.handle}
        moduleAssetUrl={props.options.cad2dModuleAssetUrl}
        fileUrl={sceneUrl}
        fileName={props.driveProps.fileName}
        format={props.format}
        height="100%"
        className="min-h-0 grow border-0"
        initialObjectKey={props.objectKey}
        toolbarLeading={props.toolbarLeading}
        onReady={(s) => {
          s.if(sql`trim(${props.objectKey}) <> ''`, (s) => {
            focusCad2dViewerObject(s, props.handle, props.objectKey);
          });
        }}
      />
    </Show>
  );
}

function HybridViewer(props: {
  driveProps: FileViewerRenderProps;
  options: CadViewerExtensionOptions;
  format: "dwg" | "dstv";
  scene: CadArtifactReference;
  glb: CadArtifactReference;
  sceneStatus: Sql;
  glbStatus: Sql;
  handle: Sql;
  objectKey: Sql;
}) {
  const nativeLabel = props.format === "dstv" ? "Operations" : "Drawing";
  const reconstructedLabel = props.format === "dstv"
    ? "Reconstructed 3D"
    : "3D model";
  const modeControl = (
    <Show when={sql`${props.glbStatus}->>'status' = 'ready'`}>
      <ButtonGroup size="sm" spacing={0}>
        <Button
          aria-pressed={sql`cad_view_mode = '2d'`}
          onClick={(s) => s.setScalar("cad_view_mode", sql.lit`2d`)}
        >
          {nativeLabel}
        </Button>
        <Button
          aria-pressed={sql`cad_view_mode = '3d'`}
          onClick={(s) => s.setScalar("cad_view_mode", sql.lit`3d`)}
        >
          {reconstructedLabel}
        </Button>
      </ButtonGroup>
    </Show>
  );
  return (
    <Data
      local
      procedure={(s) => s.defScalar("cad_view_mode", sql.lit`2d`)}
    >
      <div
        className="flex min-h-0 grow flex-col"
        role="group"
        aria-label={`${props.format.toUpperCase()} viewer mode`}
      >
        <Show when={sql`cad_view_mode = '2d'`}>
          <SceneArtifactViewer
            driveProps={props.driveProps}
            options={props.options}
            artifact={props.scene}
            format={props.format}
            handle={props.handle}
            objectKey={props.objectKey}
            status={props.sceneStatus}
            toolbarLeading={modeControl}
          />
        </Show>
        <Show when={sql`cad_view_mode = '3d'`}>
          <GlbArtifactViewer
            driveProps={props.driveProps}
            options={props.options}
            artifact={props.glb}
            handle={props.handle}
            objectKey={props.objectKey}
            status={props.glbStatus}
            browserLabel={props.format === "dstv" ? "Member" : "Model"}
            toolbarLeading={modeControl}
          />
        </Show>
      </div>
    </Data>
  );
}

function CadDriveViewer(
  props: FileViewerRenderProps,
  options: CadViewerExtensionOptions,
) {
  const uniqueId = useUniqueId();
  const rawHandle = viewerHandle(props.workspaceHandle) ??
    sql.concat(uniqueId, sql.lit`-cad-viewer`);
  const handle = typeof rawHandle === "string" ? sql.lit(rawHandle) : rawHandle;
  const objectKey = props.initialCadObjectKey ?? sql.lit``;
  return (
    <Data
      procedure={(s) => {
        s.defScalar(
          "cad_step_glb_status",
          artifactStatus(props.fileVersionId, stepViewerGlbArtifact),
        );
        s.defScalar(
          "cad_solidworks_glb_status",
          artifactStatus(props.fileVersionId, solidworksViewerGlbArtifact),
        );
        s.defScalar(
          "cad_ifc_glb_status",
          artifactStatus(props.fileVersionId, ifcViewerGlbArtifact),
        );
        s.defScalar(
          "cad_dwg_scene_status",
          artifactStatus(props.fileVersionId, dwgViewerSceneArtifact),
        );
        s.defScalar(
          "cad_dwg_glb_status",
          artifactStatus(props.fileVersionId, dwgViewerGlbArtifact),
        );
        s.defScalar(
          "cad_dxf_scene_status",
          artifactStatus(props.fileVersionId, dxfViewerSceneArtifact),
        );
        s.defScalar(
          "cad_dstv_scene_status",
          artifactStatus(props.fileVersionId, dstvViewerSceneArtifact),
        );
        s.defScalar(
          "cad_dstv_glb_status",
          artifactStatus(props.fileVersionId, dstvViewerGlbArtifact),
        );
      }}
    >
      <div
        className="flex min-h-0 flex-col bg-level1 text-primary"
        sx={{ height: props.height ?? "100%" }}
      >
        <Show
          when={fileFormatMatches("step", props.fileName, props.contentType)}
        >
          <GlbArtifactViewer
            driveProps={props}
            options={options}
            artifact={stepViewerGlbArtifact}
            handle={handle}
            objectKey={objectKey}
            status={sql`cad_step_glb_status`}
            browserLabel="Assembly"
          />
        </Show>
        <Show
          when={fileFormatMatches("ifc", props.fileName, props.contentType)}
        >
          <GlbArtifactViewer
            driveProps={props}
            options={options}
            artifact={ifcViewerGlbArtifact}
            handle={handle}
            objectKey={objectKey}
            status={sql`cad_ifc_glb_status`}
            browserLabel="Structure"
          />
        </Show>
        <Show
          when={fileFormatMatches(
            "solidworks",
            props.fileName,
            props.contentType,
          )}
        >
          <GlbArtifactViewer
            driveProps={props}
            options={options}
            artifact={solidworksViewerGlbArtifact}
            handle={handle}
            objectKey={objectKey}
            status={sql`cad_solidworks_glb_status`}
            browserLabel="Model"
          />
        </Show>
        <Show
          when={fileFormatMatches("dwg", props.fileName, props.contentType)}
        >
          <HybridViewer
            driveProps={props}
            options={options}
            format="dwg"
            scene={dwgViewerSceneArtifact}
            glb={dwgViewerGlbArtifact}
            sceneStatus={sql`cad_dwg_scene_status`}
            glbStatus={sql`cad_dwg_glb_status`}
            handle={handle}
            objectKey={objectKey}
          />
        </Show>
        <Show
          when={fileFormatMatches("dxf", props.fileName, props.contentType)}
        >
          <SceneArtifactViewer
            driveProps={props}
            options={options}
            artifact={dxfViewerSceneArtifact}
            format="dxf"
            handle={handle}
            objectKey={objectKey}
            status={sql`cad_dxf_scene_status`}
          />
        </Show>
        <Show
          when={fileFormatMatches("dstv", props.fileName, props.contentType)}
        >
          <HybridViewer
            driveProps={props}
            options={options}
            format="dstv"
            scene={dstvViewerSceneArtifact}
            glb={dstvViewerGlbArtifact}
            sceneStatus={sql`cad_dstv_scene_status`}
            glbStatus={sql`cad_dstv_glb_status`}
            handle={handle}
            objectKey={objectKey}
          />
        </Show>
      </div>
    </Data>
  );
}

/** Read-only keyed STEP, SOLIDWORKS, IFC, DWG, DXF, and DSTV inspection. */
export class CadViewerExtension implements DriveExtension {
  readonly name = "cad_viewer";
  readonly viewer: FileViewerContribution;

  constructor(readonly opts: CadViewerExtensionOptions) {
    this.viewer = {
      name: "cad_viewer",
      canView: opts.canView ?? cadFileCanView,
      render: (props) => CadDriveViewer(props, opts),
      renderReadOnly: (props) =>
        CadDriveViewer({
          ...props,
          readOnly: sql`true`,
          allowNewVersionFromHistorical: sql`false`,
        }, opts),
    };
  }

  initialize() {}
}
