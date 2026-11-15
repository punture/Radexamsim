"""``inventory`` command: one row per slide/page/image/series with privacy and quality hints.

The inventory uses opaque source ids (SHA-256 prefixes) and generated labels only. Original
file names and raw slide/page text are NOT written unless ``--include-source-text`` is given.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any

from ingest import ocr
from ingest.analysis import DEFAULT_MAX_FILE_MB, Analysis, analyze_all, enumerate_sources
from ingest.families import compute_families
from ingest.model import Finding, Unit, dedupe_findings, max_severity
from ingest.rights import combine, load_rights_map, status_for
from ingest.util import IngestError, ensure_private_dir, is_within, locator_number, tool_info, utc_now_iso, write_private_bytes, write_private_json

INVENTORY_FORMAT = "sim-ingest-inventory@1"

CSV_COLUMNS = [
    "rowId", "sourceFileId", "kind", "locator", "label", "imageCount", "dimensions", "modalityHint",
    "minDimension", "bits", "teachingAnnotations", "findingsHigh", "findingsMedium", "findingsLow",
    "identifierFindings", "commercialUseStatus", "missingMaterial", "suggestedCaseFamilyId",
]


def unit_sort_key(unit: Unit, order: dict[str, int]) -> tuple:
    return (order.get(unit.source_id, 10**9), locator_number(unit.locator), unit.locator)


def _quality(unit: Unit) -> dict[str, Any]:
    if unit.kind == "dicom_series" and unit.dicom_summary:
        s = unit.dicom_summary
        dims = [d for d in (s.get("rows"), s.get("columns")) if d]
        return {
            "minDimension": min(dims) if dims else None,
            "bits": s.get("bitsStored"),
            "lossy": False,
            "lowResolution": bool(dims and min(dims) < 256),
        }
    infos = [i.info for i in unit.images if i.info.width and i.info.height]
    mins = [min(i.width, i.height) for i in infos]
    bits = [i.bits for i in infos if i.bits]
    lossy = [i.lossy for i in infos if i.lossy is not None]
    return {
        "minDimension": min(mins) if mins else None,
        "bits": min(bits) if bits else None,
        "lossy": any(lossy) if lossy else None,
        "lowResolution": bool(mins and min(mins) < 256),
    }


def _dimensions(unit: Unit) -> list[dict[str, int | None]]:
    if unit.kind == "dicom_series" and unit.dicom_summary:
        return [{"width": unit.dicom_summary.get("columns"), "height": unit.dicom_summary.get("rows")}]
    return [{"width": i.info.width, "height": i.info.height} for i in unit.images]


def _image_count(unit: Unit) -> int:
    if unit.kind == "dicom_series" and unit.dicom_summary:
        return int(unit.dicom_summary.get("frameCount") or 0)
    if unit.video is not None:
        return 1
    return len(unit.images)


def row_json(unit: Unit, family: str | None, rights: str, extra_notes: list[str], include_text: bool) -> dict[str, Any]:
    findings = dedupe_findings(unit.findings)
    row: dict[str, Any] = {
        "rowId": unit.row_id,
        "sourceFileId": unit.source_id,
        "kind": unit.kind,
        "locator": unit.locator,
        "label": unit.label,
        "imageCount": _image_count(unit),
        "dimensions": _dimensions(unit),
        "images": [
            {
                "index": img.index,
                "sha256": img.sha256,
                **img.info.to_json(),
                "notes": img.notes,
                "fidelityNotes": img.fidelity_notes,
            }
            for img in unit.images
        ],
        "modalityHint": unit.modality_hint,
        "qualityHints": _quality(unit),
        "teachingAnnotations": unit.teaching_annotations,
        "identifierFindings": [f.to_json() for f in findings],
        "maxSeverity": max_severity(findings),
        "commercialUseStatus": rights,
        "missingMaterial": unit.missing,
        "notes": unit.notes + extra_notes,
        "suggestedCaseFamilyId": family,
    }
    if unit.kind == "dicom_series":
        row["memberSourceFileIds"] = [s.sid for s in unit.source_files]
        row["dicom"] = unit.dicom_summary
    if unit.video is not None:
        row["video"] = {"sha256": unit.video.sha256, "mimeType": unit.video.video_mime, "byteSize": unit.video.size}
    if include_text:
        row["sourceText"] = "\n\n".join(f"[{loc}]\n{text}" for loc, text in unit.text_segments) or None
    return row


def build_inventory(
    analysis: Analysis,
    rights_rules: list[tuple[str, str]],
    include_source_text: bool,
) -> dict[str, Any]:
    order = {}
    for n, src in enumerate(analysis.sources):
        order.setdefault(src.sid, n)
    for unit in analysis.dicom_units:
        first = min((order.get(s.sid, 10**9) for s in unit.source_files), default=10**9)
        order.setdefault(unit.source_id, first)
    units = sorted(analysis.units(), key=lambda u: unit_sort_key(u, order))
    row_family, families, family_notes = compute_families(units)

    source_status: dict[str, str] = {}
    for src in analysis.sources:
        source_status[src.sid] = status_for(src, rights_rules) or "unresolved"

    rows = []
    for unit in units:
        statuses = [source_status.get(s.sid, "unresolved") for s in unit.source_files] or ["unresolved"]
        rows.append(
            row_json(
                unit,
                row_family.get(unit.row_id),
                combine(statuses),
                family_notes.get(unit.row_id, []),
                include_source_text,
            )
        )
    row_by_id = {r["rowId"]: r for r in rows}
    for fam in families:
        fam["sourceFileIds"] = sorted({row_by_id[r]["sourceFileId"] for r in fam["rowIds"]})
        fam["rows"] = [{"sourceFileId": row_by_id[r]["sourceFileId"], "locator": row_by_id[r]["locator"]} for r in fam["rowIds"]]

    sources_json = []
    for src in sorted(analysis.sources, key=lambda s: order.get(s.sid, 0)):
        result = analysis.source_result_for(src.sid)
        n_rows = sum(1 for r in rows if r["sourceFileId"] == src.sid or src.sid in r.get("memberSourceFileIds", []))
        entry: dict[str, Any] = {
            "sourceFileId": src.sid,
            "sha256": src.sha256,
            "detectedType": src.detected,
            "byteSize": src.size,
            "rowCount": n_rows,
            "commercialUseStatus": source_status[src.sid],
            "identicalCopies": max(0, len(src.rels) - 1),
            "findings": [f.to_json() for f in dedupe_findings(result.findings)] if result else [],
            "notes": result.notes if result else [],
        }
        if include_source_text:
            entry["originalRelativePaths"] = src.rels or [src.rel]
        sources_json.append(entry)

    unsupported = [
        {"sourceFileId": src.sid, "detectedType": src.detected, "reason": reason}
        for src, reason in sorted(analysis.unsupported, key=lambda x: order.get(x[0].sid, 0))
    ]
    all_findings = [Finding.from_json(f) for r in rows for f in r["identifierFindings"]]
    summary = {
        "sources": len(analysis.sources),
        "rows": len(rows),
        "families": len(families),
        "unsupportedSources": len(unsupported),
        "findingsBySeverity": {s: sum(1 for f in all_findings if f.severity == s) for s in ("high", "medium", "low")},
        "rowsByKind": {k: sum(1 for r in rows if r["kind"] == k) for k in sorted({r["kind"] for r in rows})},
    }
    status = ocr.ocr_status()
    return {
        "format": INVENTORY_FORMAT,
        "generatedAt": utc_now_iso(),
        "tool": tool_info(),
        "includesSourceText": bool(include_source_text),
        "warning": (
            "INCLUDES RAW SOURCE TEXT AND ORIGINAL PATHS: treat as restricted (quarantine-level) material."
            if include_source_text
            else "No original file names or raw slide/page text are included. Automated checks help but do not prove de-identification."
        ),
        "ocr": {
            "available": status["available"],
            "engine": status["engine"],
            "note": "pixel text is checked during extract when tesseract is installed; not checked in the inventory"
            if status["available"]
            else ocr.PIXEL_TEXT_NOT_CHECKED,
        },
        "enumeration": analysis.enumeration,
        "summary": summary,
        "sources": sources_json,
        "rows": rows,
        "families": families,
        "unsupportedSources": unsupported,
    }


def _csv_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    if text and text[0] in "=+-@\t\r" and not text.lstrip("-").replace(".", "", 1).isdigit():
        text = "'" + text  # neutralise spreadsheet formulas
    return text


def inventory_csv(inv: dict[str, Any]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for r in inv["rows"]:
        findings = r["identifierFindings"]
        writer.writerow(
            [
                _csv_cell(v)
                for v in (
                    r["rowId"],
                    r["sourceFileId"],
                    r["kind"],
                    r["locator"],
                    r["label"],
                    r["imageCount"],
                    ";".join(f"{d['width']}x{d['height']}" for d in r["dimensions"]),
                    r["modalityHint"],
                    r["qualityHints"]["minDimension"],
                    r["qualityHints"]["bits"],
                    r["teachingAnnotations"],
                    sum(1 for f in findings if f["severity"] == "high"),
                    sum(1 for f in findings if f["severity"] == "medium"),
                    sum(1 for f in findings if f["severity"] == "low"),
                    " | ".join(f"{f['severity']}: {f['location']}: {f['finding']}" for f in findings),
                    r["commercialUseStatus"],
                    " | ".join(r["missingMaterial"]),
                    r["suggestedCaseFamilyId"],
                )
            ]
        )
    return buf.getvalue()


def run_inventory(
    src_dir: Path,
    out_dir: Path,
    rights_map: Path | None = None,
    institutions: list[str] | tuple[str, ...] = (),
    include_source_text: bool = False,
    max_file_mb: int = DEFAULT_MAX_FILE_MB,
    progress=None,
) -> dict[str, Any]:
    src_dir, out_dir = Path(src_dir), Path(out_dir)
    if not src_dir.is_dir():
        raise IngestError("SRC_DIR does not exist or is not a directory")
    if is_within(out_dir, src_dir):
        raise IngestError("--out must not be inside SRC_DIR (outputs would be re-ingested as sources)")
    rules = load_rights_map(rights_map)
    sources, enumeration = enumerate_sources(src_dir)
    analysis = analyze_all(sources, institutions, max_file_mb=max_file_mb, progress=progress)
    analysis.enumeration = enumeration
    inv = build_inventory(analysis, rules, include_source_text)
    ensure_private_dir(out_dir)
    write_private_json(out_dir / "inventory.json", inv)
    write_private_bytes(out_dir / "inventory.csv", inventory_csv(inv).encode("utf-8"))
    return inv
