"""Intake helper for case-per-folder archives (for example key-image exports, one folder per case).

Runs the standard pipeline (quarantine -> inventory -> extract), then builds ONE draft package
per top-level case folder by merging the families whose sources live in that folder. Families
are never split: a family whose sources span several case folders is reported, not packaged.

Privacy: original paths come only from the local quarantine manifest and never leave the
batch directory. Terminal output shows case numbers, folder labels with long digit runs
removed (possible record numbers), image counts and finding counts by severity.

Usage (from the repository root):
  tools/ingestion/.venv/bin/python -I tools/ingestion/scripts/intake_by_folder.py \
      --src path/to/download.zip --batch quarantine/box-batch-1
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath

LONG_DIGITS = re.compile(r"\d{5,}")


def sanitize(label: str) -> tuple[str, bool]:
    clean = LONG_DIGITS.sub("", label)
    clean = re.sub(r"\s+", " ", clean).strip(" -_")
    return clean or "case", clean != label.strip()


def safe_unzip(zip_path: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename
            if name.endswith("/") or PurePosixPath(name).name.startswith("."):
                continue
            target = (dest / name).resolve()
            if root not in target.parents:
                raise SystemExit("refusing a zip entry outside the batch directory")
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                out.write(src.read())


def run(py: str, *args: str) -> None:
    r = subprocess.run([py, "-I", "-m", "ingest", "-q", *args], capture_output=True, text=True)
    if r.returncode != 0:
        # The tool prints only exception types unless --debug; still keep output local.
        sys.stderr.write(r.stderr[-2000:])
        raise SystemExit(f"ingest {args[0]} failed (exit {r.returncode})")


def case_folder_of(paths: list[str], prefix_len: int) -> str | None:
    parts = PurePosixPath(paths[0]).parts
    return parts[prefix_len] if len(parts) > prefix_len + 1 else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, required=True, help="zip file or directory holding one folder per case")
    ap.add_argument("--batch", type=Path, required=True, help="batch working directory (must be git-ignored, e.g. quarantine/...)")
    ap.add_argument("--case-prefix", default="intake", help="caseId prefix for packages")
    a = ap.parse_args()

    os.umask(0o077)
    py = sys.executable
    batch: Path = a.batch
    src_dir = batch / "src"
    if a.src.is_file() and a.src.suffix.lower() == ".zip":
        safe_unzip(a.src, src_dir)
    elif a.src.is_dir():
        src_dir = a.src
    else:
        raise SystemExit("--src must be a .zip file or a directory")

    q, inv, der = batch / "q", batch / "inv", batch / "deriv"
    run(py, "quarantine", str(src_dir), "--quarantine", str(q))
    run(py, "inventory", str(q), "--out", str(inv))
    run(py, "extract", str(q), "--out", str(der), "--force")

    manifest = json.loads((q / "manifest.json").read_text())
    inventory = json.loads((inv / "inventory.json").read_text())
    paths_by_source = {sha[:16]: e["originalRelativePaths"] for sha, e in manifest["files"].items()}

    # Common leading folders (e.g. the zip's root folder) are not case folders.
    all_parts = [PurePosixPath(p[0]).parts for p in paths_by_source.values()]
    prefix_len = 0
    while all(len(p) > prefix_len + 1 for p in all_parts) and len({p[prefix_len] for p in all_parts}) == 1:
        prefix_len += 1

    families_by_case: dict[str, list[str]] = defaultdict(list)
    images_by_case: dict[str, int] = defaultdict(int)
    spanning: list[str] = []
    for fam in inventory["families"]:
        folders = {case_folder_of(paths_by_source[s], prefix_len) for s in fam["sourceFileIds"] if s in paths_by_source}
        folders.discard(None)
        if len(folders) != 1:
            spanning.append(fam["caseFamilyId"])
            continue
        folder = folders.pop()
        families_by_case[folder].append(fam["caseFamilyId"])
        images_by_case[folder] += len(fam["rowIds"])

    summary = []
    for n, folder in enumerate(sorted(families_by_case, key=str.lower), start=1):
        label, stripped = sanitize(folder)
        case_id = f"{a.case_prefix}-{n:02d}"
        pkg = batch / f"pkg-{n:02d}"
        args = ["package", "--inventory", str(inv / "inventory.json"), "--derivatives", str(der / "derivatives.json"), "--out", str(pkg),
                "--case-id", case_id, "--title", f"{label} (intake case {n:02d})", "--diagnosis", label,
                "--basis", "Owner's teaching-archive label; diagnosis and its basis to be confirmed by the owner", "--force"]
        for f in families_by_case[folder]:
            args += ["--family", f]
        run(py, *args)
        manifest_out = json.loads((pkg / "case-import.json").read_text())
        sev: dict[str, int] = defaultdict(int)
        for f in manifest_out["privacyFindings"]:
            sev[f["severity"]] += 1
        summary.append({"case": n, "caseId": case_id, "label": label, "labelHadDigits": stripped, "images": images_by_case[folder],
                        "assets": len(manifest_out["assets"]), "findings": dict(sev), "privacyStatus": manifest_out["privacyStatus"],
                        "zip": str(pkg) + ".zip"})

    (batch / "intake-summary.json").write_text(json.dumps({"cases": summary, "familiesSpanningFolders": spanning}, indent=2) + "\n")
    print(f"{'case':<5} {'label':<34} {'imgs':>4} {'high':>4} {'med':>4}  status")
    for s in summary:
        print(f"{s['case']:<5} {s['label'][:34]:<34} {s['images']:>4} {s['findings'].get('high', 0):>4} {s['findings'].get('medium', 0):>4}  {s['privacyStatus']}{'  (digits removed from label)' if s['labelHadDigits'] else ''}")
    if spanning:
        print(f"{len(spanning)} image group(s) span several folders and were not packaged; review them in the inventory.")


if __name__ == "__main__":
    main()
