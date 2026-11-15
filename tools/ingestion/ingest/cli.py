"""Command-line interface: ``python -I -m ingest <command> ...``.

Output on the terminal uses opaque source ids only; original file names are never printed.
"""

from __future__ import annotations

import argparse
import logging
import sys
import warnings
from pathlib import Path

from ingest import TOOL_NAME, __version__
from ingest.analysis import DEFAULT_MAX_FILE_MB
from ingest.phi import load_institutions
from ingest.util import IngestError, restrictive_umask


def _err(msg: str) -> None:
    print(f"{TOOL_NAME}: error: {msg}", file=sys.stderr)


def _info(msg: str, quiet: bool = False) -> None:
    if not quiet:
        print(msg, file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -I -m ingest",
        description=(
            "Restricted local ingestion and de-identification for teaching cases. Workflow: quarantine -> "
            "inventory -> extract -> owner review -> package -> import as DRAFT. Never send raw sources to "
            "external AI or cloud services."
        ),
    )
    p.add_argument("--version", action="version", version=f"{TOOL_NAME} {__version__}")
    p.add_argument("-q", "--quiet", action="store_true", help="only print errors and the final summary")
    p.add_argument(
        "--debug",
        action="store_true",
        help="show library warnings and full tracebacks (these may contain file paths or values; keep local)",
    )
    sub = p.add_subparsers(dest="command", required=True)

    inv = sub.add_parser("inventory", help="inventory slides/pages/images/series with privacy and quality hints")
    inv.add_argument("src_dir", type=Path, metavar="SRC_DIR", help="source directory or a quarantine directory")
    inv.add_argument("--out", type=Path, required=True, metavar="OUT_DIR")
    inv.add_argument("--rights-map", type=Path, metavar="rights.csv", help="CSV: match,commercialUseStatus[,note]")
    inv.add_argument("--institutions", type=Path, metavar="FILE", help="institution names to flag, one per line")
    inv.add_argument(
        "--include-source-text",
        action="store_true",
        help="ALSO write raw slide/page text and original paths (restricted output; packages built from it stay in quarantine)",
    )
    inv.add_argument("--max-file-mb", type=int, default=DEFAULT_MAX_FILE_MB)

    q = sub.add_parser("quarantine", help="copy untouched sources into a restricted, SHA-256-named quarantine")
    q.add_argument("src_dir", type=Path, metavar="SRC_DIR")
    q.add_argument("--quarantine", type=Path, required=True, metavar="QDIR")

    ex = sub.add_parser("extract", help="write approved-quality derivatives (DICOM is de-identified first)")
    ex.add_argument("qdir", type=Path, metavar="QDIR")
    ex.add_argument("--out", type=Path, required=True, metavar="DERIV_DIR")
    ex.add_argument("--render-png", action="store_true", help="also write rendered PNG frames for DICOM (first window preset)")
    ex.add_argument("--uid-key", type=Path, metavar="FILE", help="UID mapping key file (default: QDIR/uid-key, created 0600)")
    ex.add_argument("--institutions", type=Path, metavar="FILE")
    ex.add_argument("--no-ocr", action="store_true", help="do not run tesseract even if installed")
    ex.add_argument(
        "--strip-metadata",
        action="store_true",
        help="remove EXIF/XMP/text metadata from original JPEG/PNG losslessly (image data untouched; sha256 changes)",
    )
    ex.add_argument("--force", action="store_true", help="replace previous derivatives in DERIV_DIR")
    ex.add_argument("--max-file-mb", type=int, default=DEFAULT_MAX_FILE_MB)

    pk = sub.add_parser("package", help="build a sim-case-import@1 DRAFT package for one suggested family")
    pk.add_argument("--family", required=True, action="append", metavar="FAMILY_ID",
                    help="suggested caseFamilyId from the inventory (repeat to merge whole families into one case)")
    pk.add_argument("--inventory", type=Path, required=True)
    pk.add_argument("--derivatives", type=Path, required=True)
    pk.add_argument("--out", type=Path, required=True, metavar="PKG_DIR")
    pk.add_argument("--diagnosis", default=None)
    pk.add_argument("--basis", default=None)
    pk.add_argument("--truth-status", choices=["confirmed", "probable", "differential_only"], default=None)
    pk.add_argument("--case-id", default=None, help="slug for caseId (default derived from the family id)")
    pk.add_argument("--title", default=None, help="internal title (checked for identifier patterns)")
    pk.add_argument("--include-source-text", action="store_true",
                    help="put raw slide/page text into teachingText (forces privacyStatus 'quarantine')")
    pk.add_argument("--include-rendered-png", action="store_true", help="also package rendered PNG stacks of DICOM series")
    pk.add_argument("--force", action="store_true", help="rebuild an existing PKG_DIR / PKG_DIR.zip")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    with restrictive_umask(), warnings.catch_warnings():  # every file this tool writes is private to the owner
        if not args.debug:
            # Library warnings can quote attribute values (possible identifiers): keep them off the terminal.
            warnings.simplefilter("ignore")
            logging.getLogger("pydicom").setLevel(logging.CRITICAL)
            logging.getLogger("pypdf").setLevel(logging.CRITICAL)
        try:
            return _run(args)
        except Exception as exc:  # noqa: BLE001 - never print paths/values from unexpected errors
            if args.debug:
                raise
            _err(f"internal error ({type(exc).__name__}); re-run with --debug for details (output may contain paths)")
            return 3


def _run(args: argparse.Namespace) -> int:
    quiet = args.quiet
    progress = None if quiet else (lambda m: _info(m))
    try:
        if args.command == "inventory":
            from ingest.inventory import run_inventory

            if args.include_source_text:
                _info("WARNING: --include-source-text writes raw slide/page text and original paths; treat the output as restricted.")
            inv = run_inventory(
                args.src_dir,
                args.out,
                rights_map=args.rights_map,
                institutions=load_institutions(args.institutions),
                include_source_text=args.include_source_text,
                max_file_mb=args.max_file_mb,
                progress=progress,
            )
            s = inv["summary"]
            print(
                f"inventory: {s['rows']} rows from {s['sources']} sources, {s['families']} suggested families, "
                f"{s['unsupportedSources']} unsupported; findings high={s['findingsBySeverity']['high']} "
                f"medium={s['findingsBySeverity']['medium']} low={s['findingsBySeverity']['low']}"
            )
            if not inv["ocr"]["available"]:
                print(f"note: {inv['ocr']['note']}")
            return 0
        if args.command == "quarantine":
            from ingest.quarantine import run_quarantine

            stats = run_quarantine(args.src_dir, args.quarantine, progress=progress)
            print(
                f"quarantine: {stats['copied']} copied, {stats['alreadyPresent']} already present, "
                f"{stats['objects']} objects in manifest; skipped {sum(stats['skipped'].values())} (symlinks/hidden/special)"
            )
            print("reminder: keep the quarantine local - never commit, cloud-sync or upload it")
            for w in stats["warnings"]:
                print(f"WARNING: {w}", file=sys.stderr)
            return 0
        if args.command == "extract":
            from ingest.extract import run_extract

            doc = run_extract(
                args.qdir,
                args.out,
                render_png=args.render_png,
                uid_key=args.uid_key,
                institutions=load_institutions(args.institutions),
                ocr_enabled=not args.no_ocr,
                strip_metadata=args.strip_metadata,
                force=args.force,
                max_file_mb=args.max_file_mb,
                progress=progress,
            )
            s = doc["summary"]
            print(f"extract: {s['derivatives']} derivative files in {s['groups']} groups; {s['rejected']} rejected")
            for r in doc["rejected"]:
                print(f"  rejected {r['sourceFileId']}: {r['reason']}", file=sys.stderr)
            if not doc["ocr"]["available"]:
                print(f"note: {doc['ocr']['note']}")
            return 0
        if args.command == "package":
            from ingest.package import run_package

            res = run_package(
                args.family,
                args.inventory,
                args.derivatives,
                args.out,
                diagnosis=args.diagnosis,
                basis=args.basis,
                truth_status=args.truth_status,
                case_id=args.case_id,
                title=args.title,
                include_source_text=args.include_source_text,
                include_rendered_png=args.include_rendered_png,
                force=args.force,
            )
            pkg = res["package"]
            highs = sum(1 for f in pkg["privacyFindings"] if f["severity"] == "high")
            print(
                f"package: caseId={pkg['caseId']} assets={len(pkg['assets'])} privacyStatus={pkg['privacyStatus']} "
                f"(high findings: {highs}); zip written next to PKG_DIR"
            )
            print("next: review every asset and finding in the owner console; import creates a DRAFT, never an approval")
            return 0
    except IngestError as exc:
        _err(str(exc))
        return 1
    except KeyboardInterrupt:
        _err("interrupted")
        return 130
    return 2
