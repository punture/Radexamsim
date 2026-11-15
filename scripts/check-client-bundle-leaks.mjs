#!/usr/bin/env node
// Scans the built web client for content that must never reach the browser:
// clinical truth and rubric text from case fixtures (including leak canaries),
// server-only packages, and secret names. Exit code 1 on any finding.
//
//   node scripts/check-client-bundle-leaks.mjs            # builds into apps/web/.next-leakcheck first
//   node scripts/check-client-bundle-leaks.mjs --dist .next-e2e   # scan an existing build
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const argDist = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : null;
const dist = argDist ?? ".next-leakcheck";
const distDir = path.join(web, dist);

if (!argDist) {
  console.log(`Building the web client into ${dist} …`);
  execSync("npx next build", { cwd: web, stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: "1" } });
}
if (!existsSync(distDir)) {
  console.error(`No build at ${distDir}`);
  process.exit(2);
}

// ---------------------------------------------------------------- needles
const needles = [];
const add = (kind, text) => {
  const t = String(text ?? "").trim();
  if (t.length >= 14) needles.push({ kind, text: t });
};
const casesDir = path.join(root, "fixtures/generated/cases");
for (const f of readdirSync(casesDir).filter((x) => x.endsWith(".json"))) {
  const cv = JSON.parse(readFileSync(path.join(casesDir, f), "utf8"));
  add("leak canary", cv.clinicalTruth?.leakCanary);
  add("final diagnosis", cv.clinicalTruth?.finalDiagnosis);
  for (const k of cv.clinicalTruth?.keyFindings ?? []) add("key finding", k.description);
  for (const e of cv.rubric?.elements ?? []) {
    add("rubric construct", e.construct);
    for (const c of e.acceptedConcepts ?? []) add("accepted concept", c);
    for (const c of e.incorrectOrUnsafeClaims ?? []) add("unsafe criterion", c);
  }
  for (const r of cv.referenceResponses ?? []) add("reference response", r.text?.slice(0, 80));
}
for (const s of ["CANARY-TRUTH-"]) needles.push({ kind: "leak canary prefix", text: s });
const serverMarkers = [
  ["server-only package", "drizzle-orm"],
  ["server-only package", "pg-protocol"],
  ["server-only package", "@anthropic-ai/sdk"],
  ["server-only package", "fastify"],
  ["secret name", "ANTHROPIC_API_KEY"],
  ["secret name", "STRIPE_SECRET_KEY"],
  ["secret name", "STRIPE_WEBHOOK_SECRET"],
  ["secret name", "SUPABASE_SERVICE_ROLE_KEY"],
  ["secret name", "DEEPGRAM_API_KEY"],
  ["secret name", "ELEVENLABS_API_KEY"],
  ["secret name", "SESSION_SECRET"],
  ["key material", "sk-ant-"],
  ["key material", "sk_live_"],
  ["key material", "-----BEGIN PRIVATE KEY"],
];
for (const [kind, text] of serverMarkers) needles.push({ kind, text });

// ---------------------------------------------------------------- haystack
const files = [];
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|mjs|html|json|txt|rsc|css)$/.test(n)) files.push(p);
  }
};
const clientRoots = [path.join(distDir, "static"), path.join(distDir, "server/app")].filter(existsSync);
for (const r of clientRoots) walk(r);
// Only browser-delivered files: static chunks plus prerendered HTML/RSC payloads.
const delivered = files.filter((f) => f.includes(`${path.sep}static${path.sep}`) || /\.(html|rsc)$/.test(f) || f.endsWith(".body"));

const findings = [];
for (const f of delivered) {
  const body = readFileSync(f, "utf8").toLowerCase();
  for (const n of needles) if (body.includes(n.text.toLowerCase())) findings.push({ file: path.relative(web, f), ...n });
}

console.log(`Scanned ${delivered.length} browser-delivered files for ${needles.length} needles.`);
if (!argDist) rmSync(distDir, { recursive: true, force: true });
if (findings.length) {
  for (const x of findings.slice(0, 50)) console.error(`LEAK ${x.kind}: "${x.text.slice(0, 60)}" in ${x.file}`);
  console.error(`${findings.length} finding(s).`);
  process.exit(1);
}
console.log("No clinical truth, rubric content, canaries, server-only packages or secret names found in the client bundle.");
