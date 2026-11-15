import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { ApprovedAsset, CaseVersion } from "@sim/contracts";
import { validateCaseVersion } from "@sim/clinical-content";
import { FIXTURE_SPECS } from "./specs";

/**
 * Renders schematic placeholder frames, computes digests, validates each fixture case and
 * writes fixtures/generated/{cases,media}. Deterministic: same inputs -> same bytes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../generated");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "cases"), { recursive: true });

let failed = false;
for (const spec of FIXTURE_SPECS) {
  const assets: ApprovedAsset[] = spec.assets.map(({ frameCount, svg, ...asset }) => ({
    ...asset,
    frames: Array.from({ length: frameCount }, (_, i) => {
      const png = new Resvg(svg(i, frameCount), { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
      const storageKey = `fixtures/${spec.caseId}/${asset.id}/${i}.png`;
      const file = path.join(outDir, "media", storageKey);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, png);
      return {
        index: i,
        storageKey,
        mimeType: "image/png" as const,
        width: 512,
        height: 512,
        sha256: createHash("sha256").update(png).digest("hex"),
        byteSize: png.length,
        sliceLocation: null,
        instanceNumber: null,
      };
    }),
  }));
  const cv: CaseVersion = { ...spec, assets };
  const result = validateCaseVersion(cv);
  if (!result.ok) {
    failed = true;
    console.error(`✗ ${spec.caseId}`);
    for (const i of result.issues) console.error(`   [${i.severity}] ${i.path}: ${i.message}`);
    continue;
  }
  writeFileSync(path.join(outDir, "cases", `${spec.caseId}.json`), JSON.stringify(result.value, null, 2) + "\n");
  console.log(`✓ ${spec.caseId} (${assets.reduce((n, a) => n + a.frames.length, 0)} frames, ${result.warnings.length} warnings)`);
  for (const w of result.warnings) console.log(`   [warning] ${w.path}: ${w.message}`);
}
if (failed) process.exit(1);
