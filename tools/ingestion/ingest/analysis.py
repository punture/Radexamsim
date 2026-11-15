"""Source enumeration and dispatch to the per-format analysers (shared by inventory/extract)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from ingest.detect import IMAGE_TYPES, detect_type, video_mime
from ingest.dicom_series import build_series_units, classify_header, make_instance, read_header
from ingest.images import build_image_item
from ingest.model import DicomInstance, Finding, ImageInfo, ImageItem, SourceFile, SourceResult, Unit
from ingest.pdf_reader import analyze_pdf
from ingest.pptx_reader import analyze_pptx
from ingest.util import IngestError, iter_source_files, sha256_bytes, sha256_file

QUARANTINE_FORMAT = "sim-ingest-quarantine@1"
DEFAULT_MAX_FILE_MB = 2048

UNSUPPORTED_TYPE_REASONS = {
    "legacy_office": "legacy binary Office file (.ppt/.doc/.xls): convert to .pptx locally and re-run",
    "office_other": "Word/Excel document: not a supported teaching source",
    "zip_other": "zip archive: unpack it locally first (archives are not expanded)",
    "unknown": "unrecognised file type",
}


@dataclass
class Analysis:
    results: list[SourceResult] = field(default_factory=list)
    dicom_units: list[Unit] = field(default_factory=list)
    unsupported: list[tuple[SourceFile, str]] = field(default_factory=list)
    sources: list[SourceFile] = field(default_factory=list)
    enumeration: dict = field(default_factory=dict)

    def units(self) -> list[Unit]:
        out = [u for r in self.results for u in r.units]
        return out + list(self.dicom_units)

    def source_result_for(self, sid: str) -> SourceResult | None:
        for r in self.results:
            if r.source.sid == sid:
                return r
        return None


def load_quarantine_manifest(root: Path) -> dict | None:
    path = Path(root) / "manifest.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and data.get("format") == QUARANTINE_FORMAT:
        return data
    return None


def enumerate_sources(root: Path, verify_quarantine: bool = True) -> tuple[list[SourceFile], dict]:
    """List sources (deduplicated by content). Works on a plain directory or a quarantine."""
    root = Path(root)
    if not root.is_dir():
        raise IngestError("source directory does not exist or is not a directory")
    info: dict = {"mode": "directory", "duplicates": 0, "integrityErrors": 0, "skipped": {}}
    sources: dict[str, SourceFile] = {}
    manifest = load_quarantine_manifest(root)
    if manifest is not None:
        info["mode"] = "quarantine"
        for sha, entry in sorted(manifest.get("files", {}).items(), key=lambda kv: (kv[1].get("originalRelativePaths") or [""])[0]):
            path = root / entry["storedAs"]
            if not path.is_file():
                info["integrityErrors"] += 1
                continue
            if verify_quarantine and sha256_file(path) != sha:
                info["integrityErrors"] += 1
                continue
            rels = list(entry.get("originalRelativePaths") or [])
            detected = entry.get("detectedType") or detect_type(path)
            sources[sha] = SourceFile(path=path, rel=rels[0] if rels else sha, sha256=sha, size=path.stat().st_size, detected=detected, rels=rels)
        return list(sources.values()), info
    files, skipped = iter_source_files(root)
    info["skipped"] = skipped
    for f in files:
        sha = sha256_file(f)
        rel = f.relative_to(root).as_posix()
        if sha in sources:
            sources[sha].rels.append(rel)
            info["duplicates"] += 1
            continue
        sources[sha] = SourceFile(path=f, rel=rel, sha256=sha, size=f.stat().st_size, detected=detect_type(f), rels=[rel])
    return list(sources.values()), info


def analyze_image_file(src: SourceFile, data: bytes, institutions) -> SourceResult:
    result = SourceResult(source=src)
    item, _ = build_image_item(0, data, "file", "image 1", institutions, detected=src.detected)
    animated = item.info.frames > 1 and src.detected in ("gif", "png", "webp")
    unit = Unit(
        kind="cine_clip" if animated else "image_file",
        source_id=src.sid,
        locator="clip 1" if animated else "image 1",
        source_files=[src],
    )
    if animated:
        for f in item.findings:
            f.location = f.location.replace("image 1", "clip 1")
    fmt = (item.info.format or src.detected).upper()
    dims = f"{item.info.width}x{item.info.height}" if item.info.width else "unknown size"
    if animated:
        unit.label = f"Animated image {src.sid[:8]} ({fmt}, {item.info.frames} frames, {dims})"
    elif item.info.frames > 1:
        unit.label = f"Image file {src.sid[:8]} ({fmt}, {item.info.frames} pages, {dims})"
    else:
        unit.label = f"Image file {src.sid[:8]} ({fmt}, {dims})"
    if not item.info.decodable or not (item.info.browser_displayable or item.info.convertible):
        unit.missing.append(item.info.error or "image cannot be converted losslessly")
    unit.images = [item]
    unit.findings.extend(item.findings)
    unit.teaching_annotations = None
    result.units.append(unit)
    return result


def analyze_video_file(src: SourceFile, data: bytes) -> SourceResult:
    result = SourceResult(source=src)
    unit = Unit(kind="cine_clip", source_id=src.sid, locator="clip 1", source_files=[src])
    mime = video_mime(data[:64])
    unit.video = ImageItem(
        index=0, data=data, sha256=src.sha256, info=ImageInfo(detected="video", format="video", mime=mime), origin="file", video_mime=mime
    )
    unit.label = f"Video clip {src.sid[:8]} ({mime})"
    unit.missing.append("video clip is kept as original bytes but not packaged (sim-case-import@1 frames are image/DICOM only)")
    unit.findings.append(Finding("medium", "clip 1", "video frames not checked for burned-in text or faces", "pixel_text", "content"))
    result.units.append(unit)
    return result


def analyze_all(
    sources: list[SourceFile],
    institutions: list[str] | tuple[str, ...] = (),
    max_file_mb: int = DEFAULT_MAX_FILE_MB,
    progress=None,
    on_result=None,
) -> Analysis:
    """Analyse every source. ``on_result`` (if given) is called with each non-DICOM result
    while its image bytes are still in memory; the bytes are released afterwards so memory
    stays bounded by the largest single source."""
    analysis = Analysis(sources=list(sources))
    instances: list[DicomInstance] = []
    limit = max_file_mb * 1024 * 1024
    for n, src in enumerate(sources, start=1):
        if progress:
            progress(f"[{n}/{len(sources)}] analysing source {src.sid} ({src.detected})")
        if src.size > limit:
            analysis.unsupported.append((src, f"file larger than the {max_file_mb} MB limit (--max-file-mb)"))
            continue
        kind = src.detected
        try:
            if kind == "dicom":
                ds = read_header(src.path)
                reason = classify_header(ds)
                if reason:
                    analysis.unsupported.append((src, reason))
                else:
                    instances.append(make_instance(src, ds))
                continue
            if kind in UNSUPPORTED_TYPE_REASONS:
                analysis.unsupported.append((src, UNSUPPORTED_TYPE_REASONS[kind]))
                continue
            data = src.path.read_bytes()
            if sha256_bytes(data) != src.sha256:
                analysis.unsupported.append((src, "file changed while being read; re-run"))
                continue
            if kind == "pptx":
                result = analyze_pptx(src, data, institutions)
            elif kind == "pdf":
                result = analyze_pdf(src, data, institutions)
            elif kind == "video":
                result = analyze_video_file(src, data)
            elif kind in IMAGE_TYPES:
                result = analyze_image_file(src, data, institutions)
            else:
                analysis.unsupported.append((src, UNSUPPORTED_TYPE_REASONS["unknown"]))
                continue
        except Exception as exc:  # noqa: BLE001 - never let one file stop the run
            analysis.unsupported.append((src, f"could not be analysed ({type(exc).__name__})"))
            continue
        if result.unsupported_reason:
            analysis.unsupported.append((src, result.unsupported_reason))
            continue
        if on_result is not None:
            on_result(result)
        for unit in result.units:
            for item in unit.images:
                item.release()
            if unit.video is not None:
                unit.video.release()
        analysis.results.append(result)
    if instances:
        analysis.dicom_units = build_series_units(instances, institutions)
    return analysis
