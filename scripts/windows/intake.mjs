// Native Windows version of scripts/intake.sh: one-command case intake on the owner's computer
// (no cloud tokens needed).
//
//   pnpm intake "<path to a folder with one subfolder per case, or a .zip>" [batch-name]
//
// Example with Box Drive:
//   pnpm intake "C:\Users\<you>\Box\Neuro Oral Simulator - Intake batch 1"
//
// Steps:
//   1. Copy the raw files into a private, git-ignored quarantine folder.
//   2. Screen them (identifier text, metadata, OCR for burned-in names, numbers and dates).
//   3. Build one draft package per case folder.
//   4. Import only the packages with no high-severity finding, as DRAFT cases.
// Nothing is approved or published. Held-back cases are listed for the owner's decision.
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, UserError, capture, findPython, findTesseract, isFile, run, runPnpm, withPathPrepended } from "./lib.mjs";

const VENV = path.join(REPO_ROOT, "tools", "ingestion", ".venv");
const PY = path.join(VENV, "Scripts", "python.exe");

/** Runs a program; on failure, exits with its status (it has already printed why). */
function mustRun(cmd, args, opts) {
  const status = run(cmd, args, opts);
  if (status !== 0) throw new UserError("", status);
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function main([src, batchName] = []) {
  process.chdir(REPO_ROOT);
  if (!src) throw new UserError("usage: pnpm intake <case-folder-or-zip> [batch-name]");
  const batch = path.join("quarantine", batchName || `batch-${timestamp()}`);
  if (!(isFile(PY) && capture(PY, ["-I", "-c", "import ingest"]).ok)) {
    console.log("Setting up the ingestion tool's Python environment (one time)...");
    // Recreate a venv that an earlier failed attempt left without pip.
    if (!(isFile(PY) && capture(PY, ["-I", "-m", "pip", "--version"]).ok)) {
      const python = findPython([3, 13]);
      if (!python) throw new UserError("The intake tool needs Python 3.13 or newer. Install it first (Windows: winget install Python.Python.3.13).");
      mustRun(python, ["-m", "venv", "--clear", VENV]);
    }
    mustRun(PY, ["-m", "pip", "install", "-q", "-r", "tools/ingestion/requirements.txt"]);
    mustRun(PY, ["-m", "pip", "install", "-q", "--no-deps", "-e", "tools/ingestion"]);
  }
  const tesseract = findTesseract();
  if (!tesseract) {
    console.log("Note: OCR (tesseract) is not installed, so burned-in text is NOT checked. Install it first (Windows: winget install UB-Mannheim.TesseractOCR).");
  }
  // Case ids are unique per batch (e.g. batch-20261115-1012-03), so batches never collide.
  const prefix = path.basename(batch).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  // -X utf8: file names are read and printed as UTF-8, whatever the Windows code page is.
  // The ingestion tool finds tesseract on PATH.
  mustRun(PY, ["-X", "utf8", "-I", "tools/ingestion/scripts/intake_by_folder.py", "--src", src, "--batch", batch, "--case-prefix", prefix], {
    env: tesseract ? withPathPrepended(path.dirname(tesseract)) : process.env,
  });
  const summary = JSON.parse(readFileSync(path.join(batch, "intake-summary.json"), "utf8"));
  const clean = summary.cases.filter((c) => c.privacyStatus === "checked").map((c) => path.resolve(c.zip));
  if (clean.length === 0) {
    console.log(`No package passed screening; nothing imported. Review the findings in ${batch}.`);
    return 0;
  }
  // Each package's result is printed; as in intake.sh, a refused package doesn't fail the intake.
  runPnpm(["--silent", "--filter", "@sim/api", "run", "import-cases", ...clean]);
  console.log(`Done. Open the owner console (Cases) to review the drafts. Raw files stay in ${batch} (git-ignored).`);
  return 0;
}
