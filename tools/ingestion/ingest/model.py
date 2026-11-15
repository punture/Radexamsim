"""In-memory data model shared by inventory, extract and package.

Raw text and original paths live only in memory (``text_segments``, ``SourceFile.rel``)
and are written out only when the owner passes ``--include-source-text``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SEVERITY_ORDER = {"high": 3, "medium": 2, "low": 1}

# Finding scopes decide how a finding carries into a case-import package:
#   source_text  - lives in slide/page text, notes, comments, document properties.
#                  Excluding source text from the package removes the text itself.
#   content      - applies to the derivative images/DICOM that go into the package.
#   source_only  - applies to the untouched source and is resolved by processing
#                  (e.g. DICOM PHI attributes removed by de-identification).
SCOPES = ("source_text", "content", "source_only")


@dataclass
class Finding:
    severity: str
    location: str
    finding: str
    category: str = "text"
    scope: str = "content"

    def key(self) -> tuple[str, str, str]:
        return (self.severity, self.location, self.finding)

    def to_json(self) -> dict[str, str]:
        return {
            "severity": self.severity,
            "location": self.location,
            "finding": self.finding,
            "category": self.category,
            "scope": self.scope,
        }

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "Finding":
        return cls(
            severity=d["severity"],
            location=d["location"],
            finding=d["finding"],
            category=d.get("category", "text"),
            scope=d.get("scope", "content"),
        )


def dedupe_findings(findings: list[Finding]) -> list[Finding]:
    seen: set[tuple[str, str, str]] = set()
    out: list[Finding] = []
    for f in findings:
        if f.key() in seen:
            continue
        seen.add(f.key())
        out.append(f)
    out.sort(key=lambda f: (-SEVERITY_ORDER.get(f.severity, 0), f.location, f.finding))
    return out


def max_severity(findings: list[Finding]) -> str | None:
    best = None
    for f in findings:
        if best is None or SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[best]:
            best = f.severity
    return best


@dataclass
class SourceFile:
    path: Path
    rel: str  # original relative path: NEVER written to inventory/derivatives/package
    sha256: str
    size: int
    detected: str
    rels: list[str] = field(default_factory=list)  # every original path with these bytes (memory only)

    @property
    def sid(self) -> str:
        return self.sha256[:16]


@dataclass
class ImageInfo:
    detected: str
    format: str | None = None
    mime: str | None = None
    width: int | None = None
    height: int | None = None
    mode: str | None = None
    bits: int | None = None
    channels: int | None = None
    frames: int = 1
    browser_displayable: bool = False
    convertible: bool = False
    lossy: bool | None = None
    exif_orientation: int | None = None
    decodable: bool = False
    error: str | None = None
    dhash: str | None = None
    ahash: str | None = None
    grayscale_content: bool | None = None
    corner_text_risk: bool | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "format": self.format or self.detected,
            "mimeType": self.mime,
            "width": self.width,
            "height": self.height,
            "mode": self.mode,
            "bitsPerSample": self.bits,
            "channels": self.channels,
            "frames": self.frames,
            "browserDisplayable": self.browser_displayable,
            "convertible": self.convertible,
            "lossy": self.lossy,
            "exifOrientation": self.exif_orientation,
            "decodable": self.decodable,
            "decodeError": self.error,
            "dhash": self.dhash,
            "ahash": self.ahash,
            "grayscaleContent": self.grayscale_content,
        }


@dataclass
class ImageItem:
    index: int
    data: bytes | None
    sha256: str
    info: ImageInfo
    origin: str  # pptx_media | pdf_dct | pdf_jpx | pdf_decoded | file
    notes: list[str] = field(default_factory=list)
    fidelity_notes: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    pil_image: Any = None  # decoded image for sources without standalone bytes (PDF Flate etc.)
    video_mime: str | None = None
    size: int = 0  # byte size of ``data`` (kept after the bytes are released)

    def __post_init__(self) -> None:
        if self.data is not None and not self.size:
            self.size = len(self.data)

    def release(self) -> None:
        """Drop the in-memory bytes once they are no longer needed."""
        self.data = None
        self.pil_image = None


@dataclass
class DicomInstance:
    source: SourceFile
    sop_instance_uid: str
    instance_number: int | None
    ipp: list[float] | None
    iop: list[float] | None
    header: Any  # pydicom Dataset read without pixel data


@dataclass
class Unit:
    kind: str  # pptx_slide | image_file | pdf_page | dicom_series | cine_clip
    source_id: str
    locator: str
    label: str = ""
    images: list[ImageItem] = field(default_factory=list)
    text_segments: list[tuple[str, str]] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    teaching_annotations: bool | None = None
    modality_hint: str | None = None
    source_files: list[SourceFile] = field(default_factory=list)
    dicom_instances: list[DicomInstance] = field(default_factory=list)
    dicom_summary: dict[str, Any] | None = None
    group_keys: set[str] = field(default_factory=set)  # private grouping keys (never output)
    video: ImageItem | None = None

    @property
    def row_id(self) -> str:
        import hashlib

        return "r-" + hashlib.sha256(f"{self.source_id}|{self.locator}".encode()).hexdigest()[:12]


@dataclass
class SourceResult:
    source: SourceFile
    units: list[Unit] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)  # whole-file findings (e.g. deck properties)
    notes: list[str] = field(default_factory=list)
    unsupported_reason: str | None = None
