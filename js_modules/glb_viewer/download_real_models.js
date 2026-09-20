import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { REAL_MODELS } from "./real_models.js";

const outputDir = path.resolve(process.argv[2] || "/tmp/yolm-glb-real-models");
await mkdir(outputDir, { recursive: true });

for (const model of REAL_MODELS) {
  const response = await fetch(model.url);
  if (!response.ok) {
    throw new Error(`Unable to download ${model.label} (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== model.sha256) {
    throw new Error(
      `${model.label} checksum changed: expected ${model.sha256}, got ${sha256}`,
    );
  }
  await Bun.write(path.join(outputDir, model.fileName), bytes);
  console.log(
    `${model.label}: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB`,
  );
}

console.log(`Downloaded ${REAL_MODELS.length} models to ${outputDir}`);
