"""Content-based file type detection (magic bytes; file names are only a last resort)."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

IMAGE_TYPES = {"png", "jpeg", "gif", "tiff", "bmp", "webp", "jp2", "emf", "wmf", "heif", "avif", "svg"}
SUPPORTED_TYPES = {"pptx", "pdf", "dicom", "video"} | IMAGE_TYPES

VIDEO_MIME = {
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "wmv": "video/x-ms-wmv",
    "webm": "video/webm",
}

# Zip-bomb guards for OOXML packages.
MAX_ZIP_ENTRIES = 20000
MAX_ZIP_TOTAL_UNCOMPRESSED = 4 * 1024**3
MAX_ZIP_RATIO = 200


def _zip_kind(path_or_bytes) -> str:
    try:
        zf = zipfile.ZipFile(path_or_bytes if not isinstance(path_or_bytes, bytes) else io.BytesIO(path_or_bytes))
    except (zipfile.BadZipFile, OSError):
        return "unknown"
    with zf:
        names = set(zf.namelist())
    if "ppt/presentation.xml" in names:
        return "pptx"
    if "word/document.xml" in names or "xl/workbook.xml" in names:
        return "office_other"
    return "zip_other"


def check_zip_safety(data: bytes) -> str | None:
    """Return a reason string if the OOXML zip looks unsafe to expand, else None."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
    except zipfile.BadZipFile:
        return "not a valid zip/OOXML package"
    if len(infos) > MAX_ZIP_ENTRIES:
        return f"package has too many entries ({len(infos)})"
    total = 0
    for info in infos:
        total += info.file_size
        if info.file_size > 50 * 1024**2 and info.compress_size > 0:
            if info.file_size / info.compress_size > MAX_ZIP_RATIO:
                return "package entry has a suspicious compression ratio (possible zip bomb)"
    if total > MAX_ZIP_TOTAL_UNCOMPRESSED:
        return "package expands to more than 4 GiB"
    return None


def detect_type(path: Path, head: bytes | None = None) -> str:
    """Detect a source type from content. Returns a short type name."""
    path = Path(path)
    if head is None:
        with open(path, "rb") as f:
            head = f.read(4096)
    suffix = path.suffix.lower()
    if len(head) >= 132 and head[128:132] == b"DICM":
        return "dicom"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "tiff"
    if head.startswith(b"BM") and len(head) > 14:
        return "bmp"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    if head.startswith(b"RIFF") and head[8:12] == b"AVI ":
        return "video"
    if head.startswith(b"\x00\x00\x00\x0cjP  \r\n\x87\n") or head.startswith(b"\xff\x4f\xff\x51"):
        return "jp2"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"mif1", b"msf1", b"hevc", b"heim", b"heis"):
            return "heif"
        if brand in (b"avif", b"avis"):
            return "avif"
        return "video"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video"  # Matroska / WebM
    if head.startswith(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11"):
        return "video"  # ASF / WMV
    if head.startswith(b"\x01\x00\x00\x00") and head[40:44] == b" EMF":
        return "emf"
    if head.startswith(b"\xd7\xcd\xc6\x9a") or (head[:2] in (b"\x01\x00", b"\x02\x00") and head[2:4] == b"\x09\x00"):
        return "wmf"
    if b"%PDF-" in head[:1024]:
        return "pdf"
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "legacy_office"
    if head.startswith(b"PK\x03\x04"):
        return _zip_kind(path)
    stripped = head.lstrip()[:256].lower()
    if stripped.startswith(b"<svg") or (stripped.startswith(b"<?xml") and b"<svg" in head.lower()):
        return "svg"
    if suffix in (".dcm", ".dicom", ".ima", "") and _looks_like_raw_dicom(path):
        return "dicom"
    return "unknown"


def _looks_like_raw_dicom(path: Path) -> bool:
    """DICOM without the Part 10 preamble: accept only if pydicom finds core attributes."""
    try:
        import pydicom

        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
        return "SOPClassUID" in ds and ("Rows" in ds or "SOPInstanceUID" in ds)
    except Exception:  # noqa: BLE001 - any parse failure means "not DICOM"
        return False


def video_mime(head: bytes) -> str:
    if head[4:8] == b"ftyp":
        return "video/quicktime" if head[8:10] == b"qt" else "video/mp4"
    if head.startswith(b"RIFF"):
        return "video/x-msvideo"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if head.startswith(b"\x30\x26\xb2\x75"):
        return "video/x-ms-wmv"
    return "application/octet-stream"


def detect_bytes(data: bytes) -> str:
    """Detect the type of an embedded payload (PPTX media, PDF stream)."""
    head = data[:4096]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return "tiff"
    if head.startswith(b"BM"):
        return "bmp"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "webp"
    if head.startswith(b"\x00\x00\x00\x0cjP  \r\n\x87\n") or head.startswith(b"\xff\x4f\xff\x51"):
        return "jp2"
    if head.startswith(b"\x01\x00\x00\x00") and head[40:44] == b" EMF":
        return "emf"
    if head.startswith(b"\xd7\xcd\xc6\x9a") or (head[:2] in (b"\x01\x00", b"\x02\x00") and head[2:4] == b"\x09\x00"):
        return "wmf"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"heic", b"heix", b"mif1", b"msf1", b"hevc"):
            return "heif"
        if brand in (b"avif", b"avis"):
            return "avif"
        return "video"
    if head.startswith((b"\x1a\x45\xdf\xa3", b"\x30\x26\xb2\x75")) or (head.startswith(b"RIFF") and head[8:12] == b"AVI "):
        return "video"
    if head.lstrip()[:5].lower() in (b"<svg ", b"<?xml"):
        return "svg"
    if len(head) >= 132 and head[128:132] == b"DICM":
        return "dicom"
    return "unknown"
