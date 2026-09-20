import {
  GENERATED_DEFAULT_FONT_ASSETS,
  GENERATED_DEFAULT_FONT_FACES,
} from "./generated/default_font_assets";

export type DefaultFontAsset = (typeof GENERATED_DEFAULT_FONT_ASSETS)[number];
export type GlobalFontAsset = DefaultFontAsset;
export type GlobalFontAssetId = GlobalFontAsset["id"];

export type GlobalFontPreload = {
  href: string;
  type: GlobalFontAsset["type"];
};
export type DefaultFontPreload = GlobalFontPreload;

export type GlobalFontFace = (typeof GENERATED_DEFAULT_FONT_FACES)[number] & {
  default: boolean;
  format: GlobalFontAsset["format"];
  type: GlobalFontAsset["type"];
  url: string;
  r2Key: string;
};
export type DefaultFontFace = GlobalFontFace;

const fontAssetById = new Map<string, GlobalFontAsset>(
  GENERATED_DEFAULT_FONT_ASSETS.map((asset) => [asset.id, asset]),
);

export const GLOBAL_FONT_FACES: GlobalFontFace[] = GENERATED_DEFAULT_FONT_FACES
  .map((face) => {
    const asset = fontAssetById.get(face.assetId);
    if (asset === undefined) {
      throw new Error(
        `Missing global font asset '${face.assetId}' for face '${face.id}'`,
      );
    }
    return {
      ...face,
      default: asset.default,
      format: asset.format,
      type: asset.type,
      url: asset.url,
      r2Key: asset.r2Key,
    };
  });

export const DEFAULT_FONT_FACES: DefaultFontFace[] = GLOBAL_FONT_FACES.filter(
  (face) => face.default,
);

export function getGlobalFontFaces(
  assetIds: readonly GlobalFontAssetId[] = [],
  includeDefaults = true,
): GlobalFontFace[] {
  const selectedAssetIds = new Set<GlobalFontAssetId>(assetIds);
  for (const assetId of selectedAssetIds) {
    if (!fontAssetById.has(assetId)) {
      throw new Error(`Unknown global font asset '${assetId}'`);
    }
  }
  return GLOBAL_FONT_FACES.filter((face) =>
    (includeDefaults && face.default) || selectedAssetIds.has(face.assetId)
  );
}

export function getGlobalFontPreloads(
  faces: readonly GlobalFontFace[],
): GlobalFontPreload[] {
  const preloadUrls = new Set<string>();
  return faces
    .filter((face) => face.preload)
    .filter((face) => {
      if (preloadUrls.has(face.url)) {
        return false;
      }
      preloadUrls.add(face.url);
      return true;
    })
    .map((face) => ({
      href: face.url,
      type: face.type,
    }));
}

export const DEFAULT_FONT_PRELOADS: DefaultFontPreload[] =
  getGlobalFontPreloads(DEFAULT_FONT_FACES);
