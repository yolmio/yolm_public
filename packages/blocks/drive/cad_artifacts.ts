import type { Sql } from "std/sql_utils";
import { sql } from "std/sql_utils";
import type { FileVersionCreatedEvent } from "./types";
import type {
  DriveDerivationDefinition,
  DriveDerivedArtifactDefinition,
} from "./derivations";

export type FabCadFormat =
  | "step"
  | "solidworks"
  | "ifc"
  | "dwg"
  | "dxf"
  | "dstv";

export interface CadArtifactReference {
  name: string;
  recipeVersion: number;
}

interface CadFormatDefinition {
  format: FabCadFormat;
  recipeVersion: number;
  extensions: readonly string[];
  contentTypes: readonly string[];
  packageExtensions?: readonly string[];
  viewer: readonly {
    suffix: "viewer_manifest" | "viewer_glb" | "viewer_scene";
    contentType: string;
    required?: boolean;
  }[];
}

const formatDefinitions: readonly CadFormatDefinition[] = [
  {
    format: "step",
    recipeVersion: 2,
    extensions: ["step", "stp"],
    contentTypes: ["application/step", "model/step"],
    viewer: [
      { suffix: "viewer_manifest", contentType: "application/json" },
      { suffix: "viewer_glb", contentType: "model/gltf-binary" },
    ],
  },
  {
    format: "solidworks",
    recipeVersion: 1,
    extensions: ["sldprt", "sldasm"],
    contentTypes: [
      "application/sldworks",
      "application/vnd.solidworks.part",
      "application/vnd.solidworks.assembly",
    ],
    packageExtensions: ["sldprt", "sldasm"],
    viewer: [
      { suffix: "viewer_manifest", contentType: "application/json" },
      { suffix: "viewer_glb", contentType: "model/gltf-binary" },
    ],
  },
  {
    format: "ifc",
    recipeVersion: 2,
    extensions: ["ifc", "ifczip"],
    contentTypes: ["application/ifc", "model/ifc"],
    viewer: [
      { suffix: "viewer_manifest", contentType: "application/json" },
      { suffix: "viewer_glb", contentType: "model/gltf-binary" },
    ],
  },
  {
    format: "dwg",
    recipeVersion: 4,
    extensions: ["dwg"],
    contentTypes: ["application/acad", "application/dwg", "image/vnd.dwg"],
    packageExtensions: [
      "dwg",
      "shx",
      "ttf",
      "otf",
      "png",
      "jpg",
      "jpeg",
      "tif",
      "tiff",
      "bmp",
      "gif",
      "pdf",
      "dgn",
      "dwf",
      "dwfx",
      "ctb",
      "stb",
      "pc3",
      "pmp",
      "pat",
      "lin",
      "shp",
      "dws",
      "dst",
      "rcp",
      "rcs",
      "svg",
      "pcx",
      "tga",
    ],
    viewer: [
      { suffix: "viewer_manifest", contentType: "application/json" },
      {
        suffix: "viewer_scene",
        contentType: "application/vnd.yolm-fab.dwg-scene+json",
      },
      {
        suffix: "viewer_glb",
        contentType: "model/gltf-binary",
        required: false,
      },
    ],
  },
  {
    format: "dxf",
    recipeVersion: 2,
    extensions: ["dxf"],
    contentTypes: ["application/dxf", "image/vnd.dxf"],
    viewer: [
      { suffix: "viewer_manifest", contentType: "application/json" },
      {
        suffix: "viewer_scene",
        contentType: "application/vnd.yolm-fab.dxf-scene+json",
      },
    ],
  },
  {
    format: "dstv",
    recipeVersion: 4,
    extensions: ["nc1", "nc"],
    contentTypes: ["application/vnd.dstv", "text/vnd.dstv"],
    viewer: [
      { suffix: "viewer_manifest", contentType: "application/json" },
      {
        suffix: "viewer_scene",
        contentType: "application/vnd.yolm-fab.dstv-scene+json",
      },
      { suffix: "viewer_glb", contentType: "model/gltf-binary" },
    ],
  },
] as const;

function artifactHash(serviceResult: Sql, name: string): Sql {
  return sql`(
    select artifact.value->>'blobHash'
    from json.array_each(${serviceResult}->'artifacts') artifact
    where artifact.value->>'name' = ${sql.lit(name)}
    limit 1
  )`;
}

function formatMatches(
  definition: CadFormatDefinition,
  event: FileVersionCreatedEvent,
): Sql {
  const extensionMatches = definition.extensions.map((extension) =>
    sql`${event.fileName} ilike ${sql.lit(`%.${extension}`)}`
  );
  const contentTypeMatches = definition.contentTypes.map((contentType) =>
    sql`trim(${event.contentType}) ilike ${sql.lit(contentType)}`
  );
  return sql`(${sql.or(...extensionMatches, ...contentTypeMatches)})`;
}

function packageFileMatches(
  extensions: readonly string[],
  event: FileVersionCreatedEvent,
): Sql {
  return sql`(${
    sql.or(...extensions.map((extension) =>
      sql`${event.fileName} ilike ${sql.lit(`%.${extension}`)}`
    ))
  })`;
}

function prepareDefinition(
  definition: CadFormatDefinition,
): DriveDerivationDefinition {
  const primaryName = `${definition.format}_duckdb`;
  const packageExtensions = definition.packageExtensions;
  const outputs: DriveDerivedArtifactDefinition[] = [
    ...definition.viewer.map((viewer) => {
      const name = `${definition.format}_${viewer.suffix}`;
      return {
        name,
        contentType: viewer.contentType,
        resultBlobHash: (serviceResult: Sql) =>
          artifactHash(serviceResult, name),
        required: viewer.required ?? true,
        serve: true,
      };
    }),
    {
      name: `${definition.format}_artifact_manifest`,
      contentType: "application/json",
      resultBlobHash: (serviceResult) =>
        artifactHash(serviceResult, "artifact_manifest"),
      serve: true,
    },
  ];
  return {
    name: primaryName,
    recipeVersion: definition.recipeVersion,
    operation: "fab_prepare",
    contentType: "application/vnd.duckdb",
    matches: (event) => formatMatches(definition, event),
    inputCollection: packageExtensions
      ? {
        matches: (event) => packageFileMatches(packageExtensions, event),
      }
      : undefined,
    requestJson: (
      { sourceBlobHash, sourceName, sourcePath, inputCollection },
    ) =>
      sql`json_build_object(
        'sourceBlobHash', bytes.to_hex(${sourceBlobHash}),
        'sourceName', ${sourceName},
        'sourcePath', ${sourcePath},
        'format', ${sql.lit(definition.format)},
        'viewerQuality', 'high',
        'packageFiles', ${
        definition.format === "solidworks"
          ? sql`case when ${sourceName} ilike '%.sldasm'
              then ${inputCollection} else '[]'::json end`
          : inputCollection
      }
      )`,
    resultBlobHash: (serviceResult) => artifactHash(serviceResult, primaryName),
    outputs,
    maxExecutionSeconds: 900,
  };
}

export const cadPreparationDefinitions = formatDefinitions.map(
  prepareDefinition,
);

function cadArtifact(
  format: FabCadFormat,
  suffix:
    | "duckdb"
    | "viewer_manifest"
    | "viewer_glb"
    | "viewer_scene"
    | "artifact_manifest",
): CadArtifactReference {
  const definition = formatDefinitions.find((candidate) =>
    candidate.format === format
  );
  if (!definition) {
    throw new Error(`Unsupported fabrication CAD format: ${format}`);
  }
  if (
    suffix !== "duckdb" && suffix !== "artifact_manifest" &&
    !definition.viewer.some((viewer) => viewer.suffix === suffix)
  ) {
    throw new Error(
      `Fabrication CAD format ${format} does not produce ${suffix}`,
    );
  }
  return {
    name: `${format}_${suffix}`,
    recipeVersion: definition.recipeVersion,
  };
}

export const stepDuckDbArtifact = cadArtifact("step", "duckdb");
export const stepViewerGlbArtifact = cadArtifact("step", "viewer_glb");
export const solidworksDuckDbArtifact = cadArtifact("solidworks", "duckdb");
export const solidworksViewerGlbArtifact = cadArtifact(
  "solidworks",
  "viewer_glb",
);
export const ifcDuckDbArtifact = cadArtifact("ifc", "duckdb");
export const ifcViewerGlbArtifact = cadArtifact("ifc", "viewer_glb");
export const dwgDuckDbArtifact = cadArtifact("dwg", "duckdb");
export const dwgViewerSceneArtifact = cadArtifact("dwg", "viewer_scene");
export const dwgViewerGlbArtifact = cadArtifact("dwg", "viewer_glb");
export const dxfDuckDbArtifact = cadArtifact("dxf", "duckdb");
export const dxfViewerSceneArtifact = cadArtifact("dxf", "viewer_scene");
export const dstvDuckDbArtifact = cadArtifact("dstv", "duckdb");
export const dstvViewerSceneArtifact = cadArtifact("dstv", "viewer_scene");
export const dstvViewerGlbArtifact = cadArtifact("dstv", "viewer_glb");
