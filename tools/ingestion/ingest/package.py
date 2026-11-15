"""``package`` command: build a ``sim-case-import@1`` DRAFT case package for one family.

The package never claims approval: privacyStatus is "checked" only when no high-severity
finding remains AND source text is excluded; otherwise "quarantine".
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ingest import TOOL_NAME, __version__
from ingest.extract import DERIVATIVES_FORMAT
from ingest.inventory import INVENTORY_FORMAT
from ingest.model import SEVERITY_ORDER, Finding
from ingest.phi import scan_text
from ingest.schema import FORMAT, MODALITIES, validate_case_import
from ingest.util import (
    IngestError,
    copy_private,
    ensure_private_dir,
    is_slug,
    json_dumps,
    slugify,
    utc_now_iso,
    write_private_bytes,
)

TRUTH_STATUSES = ("confirmed", "probable", "differential_only")
EXT_BY_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/dicom": "dcm"}
VARIANT_ORDER = {"original": 0, "converted": 0, "dicom": 0, "rendered": 1}


def _load(path: Path, fmt: str, what: str) -> dict[str, Any]:
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise IngestError(f"{what} could not be read ({type(exc).__name__})") from exc
    if not isinstance(doc, dict) or doc.get("format") != fmt:
        raise IngestError(f"{what} is not a {fmt} document")
    return doc


def _clean_text(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(text))
    text = " ".join(text.split())
    return text[:limit] if text else None


def _convert_source_text_finding(f: dict[str, Any], location: str, include_text: bool) -> Finding:
    if include_text:
        return Finding(f["severity"], location, f["finding"] + " (raw source text IS included in this package)")
    if f["severity"] == "high":
        return Finding(
            "medium",
            location,
            f["finding"] + "; source text is NOT included in this package - check the images for the same identifiers",
        )
    return Finding("low", location, f["finding"] + "; source text is not included in this package")


def _check_out(out_dir: Path, zip_path: Path, force: bool) -> None:
    if out_dir.exists() and not out_dir.is_dir():
        raise IngestError("PKG_DIR exists and is not a directory")
    if out_dir.exists() and any(out_dir.iterdir()):
        if not force:
            raise IngestError("PKG_DIR exists and is not empty; pass --force to rebuild it")
        unexpected = [p.name for p in out_dir.iterdir() if p.name not in ("case-import.json", "frames")]
        if unexpected:
            raise IngestError("PKG_DIR contains files this tool did not create; refusing to overwrite")
    if zip_path.exists() and not force:
        raise IngestError("the package zip already exists; pass --force to rebuild it")


def _publish(staging: Path, out_dir: Path) -> None:
    """Move a fully built and validated staging directory into place."""
    if out_dir.exists():
        shutil.rmtree(out_dir / "frames", ignore_errors=True)
        (out_dir / "case-import.json").unlink(missing_ok=True)
        out_dir.rmdir()
    os.replace(staging, out_dir)
    os.chmod(out_dir, 0o700)


def _write_zip(out_dir: Path, zip_path: Path) -> None:
    files = sorted(p for p in out_dir.rglob("*") if p.is_file())
    names = sorted((p.relative_to(out_dir).as_posix() for p in files), key=lambda n: (n != "case-import.json", n))
    fd, tmp = tempfile.mkstemp(dir=zip_path.parent, prefix=".tmp-", suffix=".zip")
    os.close(fd)
    os.chmod(tmp, 0o600)
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name in names:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (0o600 & 0xFFFF) << 16
                zf.writestr(info, (out_dir / name).read_bytes())
        os.replace(tmp, zip_path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    os.chmod(zip_path, 0o600)


@dataclass
class Selection:
    """What one package contains, resolved from the inventory and derivatives."""

    family_ids: list[str]
    rows: dict[tuple[str, str], dict[str, Any]]  # (sourceFileId, locator) -> inventory row
    groups: list[dict[str, Any]]  # derivative groups that become assets, in order
    ref_ids: dict[tuple[str, str], str]  # row key -> "src-N"
    source_refs: list[dict[str, Any]]
    derivatives: dict[str, dict[str, Any]]
    deriv_root: Path
    rejected: list[dict[str, Any]] = field(default_factory=list)
    skipped_video: int = 0
    skipped_rendered: int = 0


def _select(inv: dict, der: dict, family_ids: list[str], deriv_root: Path, include_rendered_png: bool) -> Selection:
    rows = [r for r in inv["rows"] if r.get("suggestedCaseFamilyId") in family_ids]
    missing = [f for f in family_ids if f not in {r["suggestedCaseFamilyId"] for r in rows}]
    if missing:
        available = sorted({r["suggestedCaseFamilyId"] for r in inv["rows"] if r.get("suggestedCaseFamilyId")})
        raise IngestError(
            f"family {missing[0]} not found in the inventory; available families: {', '.join(available[:30]) or 'none'}"
        )
    order = {(r["sourceFileId"], r["locator"]): n for n, r in enumerate(rows)}
    candidates = [g for g in der["groups"] if (g["sourceFileId"], g["locator"]) in order]
    groups = [g for g in candidates if g["variant"] != "video" and (g["variant"] != "rendered" or include_rendered_png)]
    groups.sort(key=lambda g: (order[(g["sourceFileId"], g["locator"])], g["imageIndex"], VARIANT_ORDER.get(g["variant"], 2)))
    if not groups:
        raise IngestError("no packageable derivatives for this family (run `extract`, check derivatives.json 'rejected')")
    row_by_key = {(r["sourceFileId"], r["locator"]): r for r in rows}
    ref_ids: dict[tuple[str, str], str] = {}
    source_refs = []
    for g in groups:  # one source reference per row that contributes an asset
        key = (g["sourceFileId"], g["locator"])
        if key in ref_ids:
            continue
        row = row_by_key[key]
        ref_ids[key] = f"src-{len(ref_ids) + 1}"
        source_refs.append(
            {
                "id": ref_ids[key],
                "kind": row["kind"],
                "sourceFileId": row["sourceFileId"],
                "locator": row["locator"],
                "description": _clean_text(row["label"], 300) or f"{row['kind']} {row['locator']}",
            }
        )
    return Selection(
        family_ids=family_ids,
        rows={k: row_by_key[k] for k in ref_ids},
        groups=groups,
        ref_ids=ref_ids,
        source_refs=source_refs,
        derivatives={d["id"]: d for d in der["derivatives"]},
        deriv_root=deriv_root,
        rejected=[r for r in der.get("rejected", []) if (r["sourceFileId"], r["locator"]) in order],
        skipped_video=sum(1 for g in candidates if g["variant"] == "video"),
        skipped_rendered=sum(1 for g in candidates if g["variant"] == "rendered" and not include_rendered_png),
    )


def _copy_assets(sel: Selection, staging: Path) -> tuple[list[dict[str, Any]], list[Finding]]:
    """Copy frames into the staging directory (re-verifying SHA-256) and build asset entries."""
    root = sel.deriv_root.resolve()
    assets, findings = [], []
    for n, g in enumerate(sel.groups, start=1):
        asset_id = f"a{n}"
        ref_id = sel.ref_ids[(g["sourceFileId"], g["locator"])]
        frames = []
        for idx, did in enumerate(g["derivativeIds"]):
            d = sel.derivatives[did]
            src = (root / d["file"]).resolve()
            if not str(src).startswith(str(root) + os.sep):
                raise IngestError("derivatives.json points outside its directory; refusing")
            ext = EXT_BY_MIME.get(d["mimeType"])
            if ext is None:
                raise IngestError(f"unsupported derivative type {d['mimeType']} for {ref_id}")
            rel = f"frames/{asset_id}/{idx}.{ext}"
            if copy_private(src, staging / rel) != d["sha256"]:
                raise IngestError(f"derivative for {ref_id} {g['locator']} does not match its recorded sha256; re-run extract")
            frames.append(
                {"index": idx, "file": rel, "mimeType": d["mimeType"], "width": d["width"], "height": d["height"],
                 "sha256": d["sha256"], "byteSize": d["byteSize"]}
            )
        kind = g["assetKind"]
        if kind in ("stack", "cine") and len(frames) == 1:
            kind = "still"
        notes = g["notes"]
        if g["variant"] not in ("dicom", "rendered"):
            notes += " Modality not determined by the tool; to be set by the owner."
        assets.append(
            {
                "id": asset_id,
                "kind": kind,
                "modality": g.get("modality") if g.get("modality") in MODALITIES else "other",
                "neutralLabel": f"Image {n} (to be labelled by owner)",
                "sequence": None,
                "plane": None,
                "contrast": None,
                "frames": frames,
                "derivation": {
                    "sourceReferenceId": ref_id,
                    "method": g["method"],
                    "notes": notes.strip(),
                    "preservesDiagnosticContent": bool(g["preservesDiagnosticContent"]),
                    "burnedInAnnotationsPresent": bool(g["burnedInAnnotationsPresent"]),
                },
                "dicom": g["dicom"] if kind == "dicom_stack" else None,
            }
        )
        findings.extend(Finding(f["severity"], f"{ref_id} {f['location']}", f["finding"]) for f in g["findings"])
    return assets, findings


def _source_text_findings(sel: Selection, inv: dict, include_source_text: bool) -> list[Finding]:
    """Findings that live in slide/page text, notes and document properties (converted by inclusion).
    Content findings come from the derivative groups; source-only ones were resolved by processing."""
    out = []
    for key, row in sel.rows.items():
        for f in row["identifierFindings"]:
            if f.get("scope") == "source_text":
                out.append(_convert_source_text_finding(f, f"{sel.ref_ids[key]} {f['location']}", include_source_text))
    sources = {s["sourceFileId"]: s for s in inv.get("sources", [])}
    first_ref: dict[str, str] = {}
    for key, ref_id in sel.ref_ids.items():
        first_ref.setdefault(key[0], ref_id)
    for sid, ref_id in first_ref.items():
        for f in sources.get(sid, {}).get("findings", []):
            if f.get("scope", "source_text") == "source_text":
                out.append(_convert_source_text_finding(f, f"{ref_id} {f['location']}", include_source_text))
    return out


def run_package(
    family_ids: list[str],
    inventory_path: Path,
    derivatives_path: Path,
    out_dir: Path,
    diagnosis: str | None = None,
    basis: str | None = None,
    truth_status: str | None = None,
    case_id: str | None = None,
    title: str | None = None,
    include_source_text: bool = False,
    include_rendered_png: bool = False,
    force: bool = False,
) -> dict[str, Any]:
    out_dir = Path(out_dir)
    derivatives_path = Path(derivatives_path)
    if not family_ids:
        raise IngestError("--family is required")
    for fam in family_ids:
        if not is_slug(fam):
            raise IngestError("--family must be a family slug from the inventory (e.g. fam-0123456789ab)")
    if truth_status is not None and truth_status not in TRUTH_STATUSES:
        raise IngestError(f"--truth-status must be one of {', '.join(TRUTH_STATUSES)}")
    if case_id is not None and not is_slug(case_id):
        raise IngestError("--case-id must be a lowercase slug ([a-z0-9_-], max 80 characters)")
    inv = _load(inventory_path, INVENTORY_FORMAT, "inventory")
    der = _load(derivatives_path, DERIVATIVES_FORMAT, "derivatives file")
    sel = _select(inv, der, family_ids, derivatives_path.parent, include_rendered_png)

    zip_path = out_dir.with_name(out_dir.name + ".zip")
    _check_out(out_dir, zip_path, force)
    ensure_private_dir(out_dir.parent)
    staging = Path(tempfile.mkdtemp(prefix=f".{out_dir.name}.staging-", dir=out_dir.parent))
    try:
        assets, findings = _copy_assets(sel, staging)
        findings.extend(_source_text_findings(sel, inv, include_source_text))

        teaching_text = None
        notes_extra = []
        if include_source_text:
            parts = [f"[{sel.ref_ids[k]} {row['locator']}]\n{row['sourceText']}" for k, row in sel.rows.items() if row.get("sourceText")]
            teaching_text = "\n\n".join(parts) if parts else None
            if teaching_text is None:
                notes_extra.append("--include-source-text was given but the inventory holds no source text (re-run inventory with --include-source-text).")
            findings.append(
                Finding("high", "teachingText", "raw source text included (--include-source-text); may contain identifiers - package stays in quarantine")
            )

        clean_title = _clean_text(title, 200)
        clean_diag = _clean_text(diagnosis, 1000)
        clean_basis = _clean_text(basis, 2000)
        for label, value in (("internalTitle", clean_title), ("sourceDiagnosis", clean_diag), ("diagnosticBasis", clean_basis)):
            if value:
                findings.extend(Finding(f.severity, label, f.finding) for f in scan_text(value, label, what=f"owner-provided {label}"))

        dedup: dict[tuple[str, str, str], Finding] = {}
        for f in findings:
            dedup.setdefault(f.key(), f)
        findings = sorted(dedup.values(), key=lambda f: (-SEVERITY_ORDER[f.severity], f.location, f.finding))
        has_high = any(f.severity == "high" for f in findings)
        privacy_status = "checked" if (not has_high and not include_source_text) else "quarantine"

        family_id = family_ids[0]
        rights = sorted({row["commercialUseStatus"] for row in sel.rows.values()})
        ocr_note = der.get("ocr", {}).get("note") or ""
        reason = (
            "no high-severity finding remains and source text is excluded"
            if privacy_status == "checked"
            else "high-severity finding(s) remain or source text is included"
        )
        notes = [
            f"DRAFT import generated by {TOOL_NAME} {__version__} on {utc_now_iso()} from suggested family {', '.join(family_ids)}.",
            "Automated checks only: they help but do not prove de-identification; the owner must review every asset and finding before approval.",
            f"privacyStatus '{privacy_status}' ({reason}). The tool never sets 'approved'.",
            f"Commercial use status from the rights map (separate from privacy): {', '.join(rights)}.",
            f"OCR: {ocr_note.rstrip('.')}." if ocr_note else "",
            f"{sel.skipped_video} video clip(s) not packaged (format supports image/DICOM frames only)." if sel.skipped_video else "",
            f"{sel.skipped_rendered} rendered PNG stack(s) omitted (use --include-rendered-png to add them)." if sel.skipped_rendered else "",
            f"{len(sel.rejected)} item(s) of this family could not be extracted (see derivatives.json 'rejected', e.g. EMF/WMF or compressed DICOM)." if sel.rejected else "",
            "Sequence, plane, contrast and neutral labels are left for the owner.",
            *notes_extra,
        ]
        doc = {
            "format": FORMAT,
            "caseId": case_id or slugify("case-" + family_id.removeprefix("fam-"), fallback="case-draft"),
            "caseFamilyId": family_id,
            "internalTitle": clean_title or f"Draft case {family_id} ({len(sel.source_refs)} source references, {len(assets)} assets)",
            "sourceDiagnosis": clean_diag,
            "diagnosticBasis": clean_basis,
            "truthStatus": truth_status,
            "sourceReferences": sel.source_refs,
            "assets": assets,
            "teachingText": teaching_text,
            "privacyFindings": [{"severity": f.severity, "location": f.location, "finding": f.finding} for f in findings],
            "privacyStatus": privacy_status,
            "notes": " ".join(n for n in notes if n),
        }
        errors = validate_case_import(doc, staging)
        if errors:
            raise IngestError("internal error: package failed format validation: " + "; ".join(errors[:5]))
        write_private_bytes(staging / "case-import.json", json_dumps(doc).encode("utf-8"))
        _publish(staging, out_dir)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    _write_zip(out_dir, zip_path)
    return {"package": doc, "zip": str(zip_path)}
