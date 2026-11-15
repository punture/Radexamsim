"""``extract`` command: approved-quality derivatives from the quarantine.

* Browser-displayable originals (PNG/JPEG/WebP) are written byte-for-byte
  (method ``original_embedded``; SHA-256 of the exact bytes).
* Other rasters are converted to PNG without resampling or cropping (``format_converted``).
  EMF/WMF and other unconvertible images are reported in ``rejected``, never faked.
* DICOM series are validated, de-identified (PS3.15 Annex E subset) and written as new
  .dcm files with untouched pixel data (``dicom_export``); optional PNG renderings are
  labelled as rendered derivatives.
"""

from __future__ import annotations

import io
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from pydicom.dataset import FileMetaDataset
from pydicom.uid import PYDICOM_IMPLEMENTATION_UID

from ingest import __version__, ocr
from ingest.analysis import DEFAULT_MAX_FILE_MB, analyze_all, enumerate_sources
from ingest.dicom_deid import (
    UidMapper,
    UnsupportedDicomError,
    check_transfer_syntax,
    deidentify,
    load_or_create_key,
    scan_deidentified,
    validate_for_display,
)
from ingest.dicom_series import MODALITY_MAP, read_full, render_frames
from ingest.images import ConversionError, convert_to_png_frames, open_image, strip_jpeg_metadata, strip_png_metadata
from ingest.model import Finding, ImageItem, Unit, dedupe_findings
from ingest.quarantine import read_manifest
from ingest.util import (
    IngestError,
    ensure_private_dir,
    is_within,
    sha256_bytes,
    short_hash,
    slugify,
    tool_info,
    utc_now_iso,
    write_private_bytes,
    write_private_json,
)

DERIVATIVES_FORMAT = "sim-ingest-derivatives@1"
EXT_BY_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/dicom": "dcm"}
ORIGIN_TEXT = {
    "pptx_media": "PPTX media part (ppt/media)",
    "pdf_dct": "PDF DCTDecode (JPEG) image stream",
    "file": "standalone image file",
}


def write_dataset(ds, transfer_syntax: str) -> bytes:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = ds.SOPClassUID
    meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    meta.TransferSyntaxUID = transfer_syntax
    meta.ImplementationClassUID = PYDICOM_IMPLEMENTATION_UID
    meta.ImplementationVersionName = ("SIMINGEST_" + __version__.replace(".", ""))[:16]
    ds.file_meta = meta
    ds.preamble = b"\x00" * 128  # never carry over a vendor/TIFF preamble
    buf = io.BytesIO()
    ds.save_as(buf, enforce_file_format=True)
    return buf.getvalue()


class Extractor:
    def __init__(
        self,
        out_dir: Path,
        mapper: UidMapper | None,
        render_png: bool,
        ocr_enabled: bool,
        institutions: list[str] | tuple[str, ...],
        strip_metadata: bool,
    ):
        self.out_dir = out_dir
        self.mapper = mapper
        self.render_png = render_png
        self.ocr_available = bool(ocr_enabled and ocr.tesseract_path())
        self.institutions = institutions
        self.strip_metadata = strip_metadata
        self.derivatives: list[dict[str, Any]] = []
        self.groups: list[dict[str, Any]] = []
        self.rejected: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ helpers
    def reject(self, sid: str, locator: str, index: int | None, reason: str) -> None:
        self.rejected.append({"sourceFileId": sid, "locator": locator, "imageIndex": index, "reason": reason})

    def _write(self, rel: str, data: bytes) -> dict[str, Any]:
        write_private_bytes(self.out_dir / rel, data)
        return {"file": rel, "sha256": sha256_bytes(data), "byteSize": len(data)}

    def _folder(self, sid: str, locator: str) -> str:
        return f"files/{sid}/{slugify(locator, fallback='item')}"

    def _pixel_text(self, frames: list[tuple[bytes, str]], location: str) -> list[Finding]:
        if not self.ocr_available:
            return [Finding("medium", location, ocr.PIXEL_TEXT_NOT_CHECKED, "pixel_text", "content")]
        picks = sorted({0, len(frames) // 2, len(frames) - 1}) if frames else []
        found: list[Finding] = []
        for k in picks:
            data, suffix = frames[k]
            found.extend(ocr.ocr_findings(ocr.run_ocr(data, suffix), location, self.institutions))
        return dedupe_findings(found)

    def _add_group(self, unit: Unit, index: int, variant: str, asset_kind: str, method: str, entries, notes, preserves,
                   burned, findings, modality=None, dicom=None, deid=None, original_sha=None) -> None:
        sid, loc = unit.source_id, unit.locator
        group_id = "g-" + short_hash(f"{sid}|{loc}|{index}|{variant}", 16)
        ids = []
        for frame_index, e in enumerate(entries):
            did = f"d{len(self.derivatives) + 1:05d}"
            ids.append(did)
            self.derivatives.append(
                {
                    "id": did,
                    "groupId": group_id,
                    "sourceFileId": sid,
                    "locator": loc,
                    "kind": unit.kind,
                    "imageIndex": index,
                    "frameIndex": frame_index,
                    "variant": variant,
                    "method": method,
                    "file": e["file"],
                    "sha256": e["sha256"],
                    "mimeType": e["mimeType"],
                    "width": e["width"],
                    "height": e["height"],
                    "byteSize": e["byteSize"],
                    "notes": e.get("notes", notes),
                    "originalSha256": e.get("originalSha256", original_sha),
                }
            )
        self.groups.append(
            {
                "groupId": group_id,
                "sourceFileId": sid,
                "locator": loc,
                "kind": unit.kind,
                "imageIndex": index,
                "variant": variant,
                "assetKind": asset_kind,
                "method": method,
                "modality": modality,
                "derivativeIds": ids,
                "notes": notes,
                "preservesDiagnosticContent": bool(preserves),
                "burnedInAnnotationsPresent": bool(burned),
                "teachingAnnotationsOnSource": unit.teaching_annotations,
                "findings": [f.to_json() for f in dedupe_findings(findings)],
                "dicom": dicom,
                "deidentification": deid,
                "originalSha256": original_sha,
            }
        )

    # ------------------------------------------------------------------ images
    def _strip(self, item: ImageItem) -> tuple[bytes | None, str]:
        if item.info.exif_orientation not in (None, 1):
            return None, "metadata NOT stripped: removing EXIF would change the displayed orientation"
        if item.info.detected == "jpeg":
            out = strip_jpeg_metadata(item.data)
        elif item.info.detected == "png":
            out = strip_png_metadata(item.data)
        else:
            return None, "metadata NOT stripped: supported for JPEG and PNG only"
        if out is None:
            return None, "metadata NOT stripped: stream could not be parsed safely"
        try:
            same = np.array_equal(np.asarray(open_image(item.data)), np.asarray(open_image(out)))
        except Exception:  # noqa: BLE001
            same = False
        if not same:
            return None, "metadata NOT stripped: decoded pixels would differ"
        return out, "embedded metadata segments removed losslessly (--strip-metadata); compressed image data unchanged"

    def emit_image(self, unit: Unit, item: ImageItem) -> None:
        sid, loc = unit.source_id, unit.locator
        img_loc = f"{loc} image {item.index + 1}" if unit.kind in ("pptx_slide", "pdf_page") else loc
        findings = list(item.findings)
        notes: list[str] = []
        frames: list[dict[str, Any]] = []
        preserves = True
        folder = self._folder(sid, loc)
        if item.origin == "pdf_decoded":
            method, variant = "format_converted", "converted"
            notes.append("PDF image stream without a standalone file format, stored as lossless PNG of the decoded samples.")
            frames.append({"data": item.data, "mimeType": "image/png", "width": item.info.width, "height": item.info.height})
        elif item.info.browser_displayable:
            method, variant = "original_embedded", "original"
            data = item.data
            notes.append(f"Original image bytes from the {ORIGIN_TEXT.get(item.origin, item.origin)} (no recompression).")
            if self.strip_metadata and any(f.category == "metadata" and f.scope == "content" for f in findings):
                stripped, message = self._strip(item)
                notes.append(message + ".")
                if stripped is not None:
                    data = stripped
                    findings = [f for f in findings if not (f.category == "metadata" and f.scope == "content")]
                    findings.append(Finding("low", img_loc, "embedded metadata stripped losslessly (--strip-metadata)", "metadata", "content"))
            frames.append({"data": data, "mimeType": item.info.mime, "width": item.info.width, "height": item.info.height})
        elif item.info.decodable and item.info.convertible:
            try:
                pngs, conv_notes, lossless = convert_to_png_frames(item.data, item.info.detected)
            except ConversionError as exc:
                self.reject(sid, loc, item.index, f"{img_loc}: {exc}")
                return
            method, variant = "format_converted", "converted"
            preserves = lossless
            fmt = (item.info.format or item.info.detected).upper()
            notes.append(
                f"{fmt} is not displayed by browsers; converted to PNG without resampling or cropping "
                f"({'lossless' if lossless else 'NOT bit-exact - see notes'}); original sha256 {item.sha256}."
            )
            notes.extend(n + "." for n in conv_notes)
            frames.extend({"data": p.data, "mimeType": "image/png", "width": p.width, "height": p.height} for p in pngs)
        else:
            self.reject(sid, loc, item.index, f"{img_loc}: {item.info.error or 'image cannot be converted losslessly'}")
            return
        notes.extend(n[0].upper() + n[1:] + "." for n in item.notes)
        notes.extend(n[0].upper() + n[1:] + "." for n in item.fidelity_notes)
        if unit.teaching_annotations and unit.kind == "pptx_slide":
            notes.append("Teaching annotations on the slide are separate shapes and are not part of this image.")
        if len(frames) == 1:
            asset_kind = "still"
        elif item.info.detected in ("gif", "png", "webp"):
            asset_kind = "cine"
        else:
            asset_kind = "stack"
        pixel = self._pixel_text([(f["data"], "." + EXT_BY_MIME[f["mimeType"]]) for f in frames], img_loc)
        findings.extend(pixel)
        burned = any(f.category == "ocr" and f.severity in ("high", "medium") for f in pixel)
        entries = []
        for k, f in enumerate(frames):
            ext = EXT_BY_MIME[f["mimeType"]]
            rel = f"{folder}/img{item.index + 1}-f{k:04d}.{ext}"
            written = self._write(rel, f["data"])
            entries.append({**written, "mimeType": f["mimeType"], "width": f["width"], "height": f["height"]})
        original_sha = item.sha256
        self._add_group(unit, item.index, variant, asset_kind, method, entries, " ".join(notes), preserves, burned,
                        findings, original_sha=original_sha)

    def emit_video(self, unit: Unit) -> None:
        v = unit.video
        if v is None or not v.data:
            self.reject(unit.source_id, unit.locator, 0, f"{unit.locator}: media clip not embedded")
            return
        ext = {"video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-msvideo": "avi", "video/x-ms-wmv": "wmv"}.get(v.video_mime or "", "bin")
        rel = f"{self._folder(unit.source_id, unit.locator)}/clip.{ext}"
        written = self._write(rel, v.data)
        entry = {**written, "mimeType": v.video_mime or "application/octet-stream", "width": None, "height": None}
        notes = ("Original media clip bytes (no transcoding). Not packaged: sim-case-import@1 frames are image/DICOM only; "
                 "frames were not checked for burned-in text or faces.")
        self._add_group(unit, 0, "video", "video", "original_embedded", [entry], notes, True, False,
                        list(unit.findings), original_sha=v.sha256)

    # ------------------------------------------------------------------ DICOM
    def emit_series(self, unit: Unit) -> None:
        """De-identify and write a series instance by instance (bounded memory). A series is
        all-or-nothing: on any failure its partial output is removed and it is rejected."""
        sid, loc = unit.source_id, unit.locator
        summary = unit.dicom_summary or {}
        if not summary.get("supported"):
            self.reject(sid, loc, 0, summary.get("rejectReason") or f"{loc}: series could not be validated")
            return
        if self.mapper is None:
            raise IngestError("internal error: no UID mapper")
        meta = summary["metadata"]
        folder = self._folder(sid, loc)
        window = meta["windowPresets"][0] if meta["windowPresets"] else None
        center = window["center"] if window else None
        width = window["width"] if window else None
        render_note = (
            f"WindowCenter={center:g} WindowWidth={width:g} (first preset, '{window['label']}')"
            if window
            else "full dynamic range (no WindowCenter/WindowWidth in the series)"
        )
        want_render = self.render_png or self.ocr_available
        render_failed = False
        entries: list[dict[str, Any]] = []
        rendered: list[tuple[bytes, int, int]] = []
        reports: list[dict[str, Any]] = []
        findings: list[Finding] = []
        try:
            for k, inst in enumerate(unit.dicom_instances):
                ds = read_full(inst.source.path)
                validate_for_display(ds, where=loc, check_pixels=True)
                ts = check_transfer_syntax(ds, loc)
                pixels_before = sha256_bytes(bytes(ds.PixelData))
                if not str(getattr(ds, "SOPInstanceUID", "") or ""):
                    ds.SOPInstanceUID = self.mapper(f"missing-sop-instance:{inst.source.sha256}")
                reports.append(deidentify(ds, self.mapper))
                data = write_dataset(ds, ts)
                check = pydicom.dcmread(io.BytesIO(data))
                if sha256_bytes(bytes(check.PixelData)) != pixels_before:
                    raise UnsupportedDicomError(f"{loc}: pixel data changed during export; series not exported")
                if str(getattr(check, "PatientIdentityRemoved", "")) != "YES":
                    raise UnsupportedDicomError(f"{loc}: de-identification marker missing after export")
                findings.extend(scan_deidentified(check, loc, self.institutions))
                written = self._write(f"{folder}/f{k:04d}.dcm", data)
                entries.append({**written, "mimeType": "application/dicom", "width": int(check.Columns), "height": int(check.Rows)})
                if want_render and not render_failed:
                    try:
                        rendered.extend(render_frames(check, center, width))
                    except Exception as exc:  # noqa: BLE001
                        render_failed = True
                        rendered = []
                        render_note = f"rendering failed ({type(exc).__name__})"
        except Exception as exc:  # noqa: BLE001 - all-or-nothing per series
            shutil.rmtree(self.out_dir / folder, ignore_errors=True)
            reason = str(exc) if isinstance(exc, UnsupportedDicomError) else f"{loc}: DICOM export failed ({type(exc).__name__}); series not exported"
            self.reject(sid, loc, 0, reason)
            return

        agg: dict[str, Any] = {
            "profile": "DICOM PS3.15 Annex E Basic Application Level Confidentiality Profile (documented subset)",
            "removed": sorted({k for r in reports for k in r["removed"]}),
            "blanked": sorted({k for r in reports for k in r["blanked"]}),
            "descriptorsKept": sorted({k for r in reports for k in r["descriptorsKept"]}),
            "descriptorsRemoved": sorted({k for r in reports for k in r["descriptorsRemoved"]}),
            "privateAttributesRemoved": sum(r["privateRemoved"] for r in reports),
            "uidValuesReplaced": sum(r["uidsReplaced"] for r in reports),
            "dateTimeValuesRemoved": sum(r["datesRemoved"] for r in reports),
            "overlayElementsRemoved": sum(r["overlayElementsRemoved"] for r in reports),
            "unknownPublicAttributesRemoved": sum(r["unknownPublicRemoved"] for r in reports),
            "pixelDataModified": False,
        }
        findings.append(
            Finding(
                "low",
                loc,
                f"DICOM header de-identified (PS3.15 Annex E subset): {len(agg['removed']) + len(agg['blanked'])} attribute "
                f"types removed/blanked, {agg['privateAttributesRemoved']} private attributes removed, "
                f"{agg['uidValuesReplaced']} UID values replaced; pixel data unchanged",
                "dicom_tag",
                "content",
            )
        )
        if agg["descriptorsRemoved"]:
            findings.append(
                Finding("low", loc, "descriptor(s) removed because they contained non-vocabulary text: " + ", ".join(agg["descriptorsRemoved"]), "dicom_tag", "content")
            )
        findings.extend(f for f in unit.findings if f.scope == "content" and f.category == "recognizable_features")

        if rendered or not self.ocr_available:
            pixel = self._pixel_text([(png, ".png") for png, _w, _h in rendered], loc)
        else:
            pixel = [Finding("medium", loc, "pixel text not checked: frames could not be rendered for OCR", "pixel_text", "content")]
        findings.extend(pixel)
        burned = any(f.category == "dicom_burned_in" and f.severity == "high" for f in findings) or any(
            f.category == "ocr" and f.severity in ("high", "medium") for f in pixel
        )
        notes = (
            f"De-identified DICOM ({agg['profile']}); pixel data unchanged; {len(entries)} instance(s) sorted by "
            f"{meta['sortedBy']} (geometryValidated={str(meta['geometryValidated']).lower()})."
        )
        extra = [n for n in unit.notes if n]
        if extra:
            notes += " " + " ".join(n[0].upper() + n[1:] + "." for n in extra)
        modality = MODALITY_MAP.get(summary.get("modality") or "", "other")
        self._add_group(unit, 0, "dicom", "dicom_stack", "dicom_export", entries, notes, True, burned, findings,
                        modality=modality, dicom=meta, deid=agg)
        if self.render_png and rendered:
            r_entries = []
            for k, (png, w, h) in enumerate(rendered):
                written = self._write(f"{folder}/render-f{k:04d}.png", png)
                r_entries.append({**written, "mimeType": "image/png", "width": w, "height": h})
            r_notes = (
                f"Rendered derivative: 8-bit PNG of the de-identified DICOM using {render_note}; display/review copy "
                "only, not the diagnostic original (dynamic range outside the window is clipped)."
            )
            self._add_group(unit, 0, "rendered", "still" if len(r_entries) == 1 else "stack", "dicom_export", r_entries,
                            r_notes, False, burned, list(pixel), modality=modality)
        elif self.render_png and render_failed:
            self.reject(sid, loc, 0, f"{loc}: PNG rendering failed ({render_note}); de-identified DICOM was still exported")


def prepare_output(out_dir: Path, qdir: Path, force: bool) -> None:
    if is_within(out_dir, qdir):
        raise IngestError("--out must not be inside the quarantine directory")
    if is_within(qdir, out_dir):
        raise IngestError("the quarantine directory must not be inside --out")
    marker = out_dir / "derivatives.json"
    if marker.exists():
        if not force:
            raise IngestError("--out already contains derivatives.json; pass --force to replace previous derivatives")
        shutil.rmtree(out_dir / "files", ignore_errors=True)
        marker.unlink()
    elif out_dir.exists() and any(out_dir.iterdir()):
        raise IngestError("--out exists and is not empty")
    ensure_private_dir(out_dir)


def run_extract(
    qdir: Path,
    out_dir: Path,
    render_png: bool = False,
    uid_key: Path | None = None,
    institutions: list[str] | tuple[str, ...] = (),
    ocr_enabled: bool = True,
    strip_metadata: bool = False,
    force: bool = False,
    max_file_mb: int = DEFAULT_MAX_FILE_MB,
    progress=None,
) -> dict[str, Any]:
    qdir, out_dir = Path(qdir), Path(out_dir)
    read_manifest(qdir)
    prepare_output(out_dir, qdir, force)
    sources, enumeration = enumerate_sources(qdir, verify_quarantine=True)
    ex = Extractor(out_dir, None, render_png, ocr_enabled, institutions, strip_metadata)

    def emit(result) -> None:  # called per source while its bytes are in memory
        for unit in result.units:
            if progress:
                progress(f"extracting {unit.source_id} {unit.locator}")
            if unit.video is not None:
                ex.emit_video(unit)
                continue
            for item in unit.images:
                ex.emit_image(unit, item)
            for reason in unit.missing:
                if reason.startswith("linked") or "OLE" in reason:
                    ex.reject(unit.source_id, unit.locator, None, f"{unit.locator}: {reason}")

    analysis = analyze_all(sources, institutions, max_file_mb=max_file_mb, progress=progress, on_result=emit)
    mapper = None
    if analysis.dicom_units:
        key = load_or_create_key(uid_key or (qdir / "uid-key"))
        map_path = qdir / "uid-map.json"
        existing = {}
        if map_path.exists():
            existing = json.loads(map_path.read_text(encoding="utf-8")).get("map", {})
        mapper = UidMapper(key, existing)
        ex.mapper = mapper
        for unit in analysis.dicom_units:
            if progress:
                progress(f"de-identifying {unit.source_id} {unit.locator}")
            ex.emit_series(unit)
    for src, reason in analysis.unsupported:
        ex.reject(src.sid, "file", None, reason)
    if mapper is not None:
        write_private_json(
            qdir / "uid-map.json",
            {"warning": "RESTRICTED: maps original DICOM UIDs to replacements. Keep with the quarantine.", "map": mapper.map},
        )
    status = ocr.ocr_status(ocr_enabled)
    doc = {
        "format": DERIVATIVES_FORMAT,
        "generatedAt": utc_now_iso(),
        "tool": tool_info(),
        "ocr": status,
        "options": {"renderPng": bool(render_png), "stripMetadata": bool(strip_metadata)},
        "summary": {
            "derivatives": len(ex.derivatives),
            "groups": len(ex.groups),
            "rejected": len(ex.rejected),
            "integrityErrors": enumeration.get("integrityErrors", 0),
        },
        "derivatives": ex.derivatives,
        "groups": ex.groups,
        "rejected": ex.rejected,
    }
    write_private_json(out_dir / "derivatives.json", doc)
    return doc
