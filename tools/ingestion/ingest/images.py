"""Raster image probing, perceptual hashing, metadata checks and lossless PNG conversion.

Rules (product spec): original bytes are kept whenever the browser can display them
(PNG, JPEG, WebP). Otherwise the image is converted to PNG losslessly. Images are never
cropped, resampled, inpainted or synthesised; dimensions and orientation are preserved.
"""

from __future__ import annotations

import io
import struct
import warnings
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

from ingest.model import Finding, ImageInfo
from ingest.phi import scan_text

# Refuse absurdly large rasters instead of risking decompression bombs.
Image.MAX_IMAGE_PIXELS = 120_000_000

BROWSER_MIME = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}
DECODABLE_TYPES = {"png", "jpeg", "gif", "tiff", "bmp", "webp", "jp2", "avif"}
UNSUPPORTED_REASONS = {
    "emf": "EMF vector metafile: cannot be rasterised on this platform (Pillow only renders EMF/WMF on Windows); not converted",
    "wmf": "WMF vector metafile: cannot be rasterised on this platform (Pillow only renders EMF/WMF on Windows); not converted",
    "heif": "HEIF/HEIC image: no decoder available; not converted",
    "svg": "SVG vector image: not rasterised (may contain text); not converted",
}

MODE_BITS = {
    "1": 1, "L": 8, "P": 8, "LA": 8, "PA": 8, "RGB": 8, "RGBA": 8, "RGBX": 8, "RGBa": 8, "CMYK": 8,
    "YCbCr": 8, "LAB": 8, "HSV": 8, "I;16": 16, "I;16B": 16, "I;16L": 16, "I;16N": 16, "I": 32, "F": 32,
}


class ConversionError(Exception):
    pass


def open_image(data: bytes) -> Image.Image:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        img = Image.open(io.BytesIO(data))
        img.load()
    return img


def _webp_lossy(data: bytes) -> bool | None:
    if data[12:16] == b"VP8 ":
        return True
    if data[12:16] == b"VP8L":
        return False
    if data[12:16] == b"VP8X":
        if b"VP8L" in data[:4096]:
            return False
        if b"VP8 " in data[:4096]:
            return True
    return None


def probe_image(data: bytes, detected: str) -> tuple[ImageInfo, Image.Image | None]:
    """Describe an image; return (info, decoded first frame or None)."""
    info = ImageInfo(detected=detected)
    if detected in UNSUPPORTED_REASONS:
        info.format = detected.upper()
        info.error = UNSUPPORTED_REASONS[detected]
        if detected in ("emf", "wmf"):
            try:  # the Pillow stub reads the header size without rendering
                with Image.open(io.BytesIO(data)) as stub:
                    info.width, info.height = stub.size
            except Exception:  # noqa: BLE001
                pass
        return info, None
    if detected not in DECODABLE_TYPES:
        info.error = f"unsupported image type '{detected}'"
        return info, None
    try:
        img = open_image(data)
    except Image.DecompressionBombError:
        info.error = "image exceeds the pixel limit (possible decompression bomb); not decoded"
        return info, None
    except Exception as exc:  # noqa: BLE001
        info.error = f"image could not be decoded ({type(exc).__name__})"
        return info, None
    info.decodable = True
    info.format = img.format
    info.mode = img.mode
    info.width, info.height = img.size
    info.frames = int(getattr(img, "n_frames", 1) or 1)
    info.bits = MODE_BITS.get(img.mode)
    info.channels = len(img.getbands())
    if detected == "jpeg":
        info.lossy = True
        info.frames = 1  # MPO secondary pictures are previews; the browser shows the primary JPEG
    elif detected == "webp":
        info.lossy = _webp_lossy(data)
    elif detected in ("png", "tiff", "bmp", "gif"):
        info.lossy = False if detected != "tiff" else (img.info.get("compression") in ("jpeg", "tiff_jpeg"))
    elif detected in ("jp2", "avif"):
        info.lossy = None
    try:
        orientation = img.getexif().get(0x0112)
        info.exif_orientation = int(orientation) if orientation else None
    except Exception:  # noqa: BLE001
        info.exif_orientation = None
    info.mime = BROWSER_MIME.get(detected)
    info.browser_displayable = detected in BROWSER_MIME and info.frames == 1
    info.convertible = not info.browser_displayable and img.mode != "F"
    try:
        display = ImageOps.exif_transpose(img.copy()) if info.exif_orientation not in (None, 1) else img
        gray = gray_for_analysis(display)
        info.dhash, info.ahash = perceptual_hashes(gray)
        info.grayscale_content = is_grayscale_content(display)
        info.corner_text_risk = corner_text_risk(gray)
    except Exception:  # noqa: BLE001 - analysis hints are best effort
        pass
    return info, img


# ---------------------------------------------------------------------------
# Perceptual hashing (dHash + aHash, 16x16 = 256 bits each)
# ---------------------------------------------------------------------------


def gray_for_analysis(img: Image.Image) -> Image.Image:
    im = img
    if im.mode in ("I;16", "I;16B", "I;16L", "I;16N", "I", "F"):
        arr = np.asarray(im, dtype=np.float64)
        lo, hi = float(arr.min()), float(arr.max())
        scaled = np.zeros_like(arr) if hi <= lo else (arr - lo) * (255.0 / (hi - lo))
        return Image.fromarray(np.clip(scaled, 0, 255).astype(np.uint8))
    if im.mode in ("RGBA", "LA", "PA", "RGBa") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (0, 0, 0, 255))
        im = Image.alpha_composite(bg, im)
    return im.convert("L")


def _bits_to_hex(bits: np.ndarray) -> str:
    value = 0
    for b in bits.flatten():
        value = (value << 1) | int(bool(b))
    return f"{value:0{bits.size // 4}x}"


def perceptual_hashes(gray: Image.Image, size: int = 16) -> tuple[str, str]:
    d = np.asarray(gray.resize((size + 1, size), Image.Resampling.LANCZOS), dtype=np.int16)
    dhash = _bits_to_hex(d[:, 1:] > d[:, :-1])
    a = np.asarray(gray.resize((size, size), Image.Resampling.LANCZOS), dtype=np.float64)
    ahash = _bits_to_hex(a > a.mean())
    return dhash, ahash


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def is_grayscale_content(img: Image.Image) -> bool:
    if img.mode in ("1", "L", "LA", "I", "I;16", "I;16B", "I;16L", "I;16N", "F"):
        return True
    small = img.convert("RGB")
    small.thumbnail((128, 128))
    arr = np.asarray(small, dtype=np.int16)
    spread = arr.max(axis=2) - arr.min(axis=2)
    return float(np.mean(spread > 12)) < 0.02


def _components(mask: np.ndarray) -> list[int]:
    """Sizes of 4-connected components of a small boolean mask."""
    seen = np.zeros_like(mask, dtype=bool)
    h, w = mask.shape
    sizes = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        n = 0
        while stack:
            y, x = stack.pop()
            n += 1
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        sizes.append(n)
    return sizes


def corner_text_risk(gray: Image.Image) -> bool:
    """Heuristic only: thin, high-contrast, multi-blob marks on a uniform corner background.

    Typical burned-in PACS overlays (name, MRN, institution) sit in image corners. This is
    NOT OCR and proves nothing either way; a positive result is flagged for owner review.
    """
    g = gray.copy()
    g.thumbnail((512, 512))
    arr = np.asarray(g, dtype=np.int16)
    h, w = arr.shape
    if min(h, w) < 64:
        return False
    rh, rw = max(10, h // 6), max(10, w // 4)
    regions = [arr[:rh, :rw], arr[:rh, -rw:], arr[-rh:, :rw], arr[-rh:, -rw:]]
    for region in regions:
        med = float(np.median(region))
        if float(np.mean(np.abs(region - med) <= 20)) < 0.6:
            continue  # not a uniform background (anatomy or texture)
        fg = np.abs(region - med) > 80
        frac = float(fg.mean())
        if not (0.003 <= frac <= 0.25):
            continue
        interior = fg & np.roll(fg, 1, 0) & np.roll(fg, -1, 0) & np.roll(fg, 1, 1) & np.roll(fg, -1, 1)
        boundary_ratio = 1.0 - interior.sum() / max(1, fg.sum())
        if boundary_ratio < 0.5:
            continue  # thick blobs, not strokes
        sizes = _components(fg)
        small = [s for s in sizes if s <= 0.02 * region.size]
        if len(small) >= 4:
            return True
    return False


# ---------------------------------------------------------------------------
# Embedded metadata (EXIF / XMP / PNG text / comments)
# ---------------------------------------------------------------------------

_EXIF_TEXT_TAGS = {
    0x010D: "DocumentName", 0x010E: "ImageDescription", 0x011D: "PageName", 0x013C: "HostComputer",
    0x8298: "Copyright", 0x9C9B: "XPTitle", 0x9C9C: "XPComment", 0x9C9E: "XPKeywords", 0x9C9F: "XPSubject",
}
_EXIF_NAME_TAGS = {0x013B: "Artist", 0x9C9D: "XPAuthor"}
_EXIF_IFD_TEXT = {0x9286: "UserComment"}
_EXIF_IFD_NAME = {0xA430: "CameraOwnerName"}
_EXIF_IFD_SERIAL = {0xA431: "BodySerialNumber", 0xA435: "LensSerialNumber", 0xA420: "ImageUniqueID"}
_EXIF_DATES = {0x0132: "DateTime"}
_EXIF_IFD_DATES = {0x9003: "DateTimeOriginal", 0x9004: "DateTimeDigitized"}


def _as_text(value, utf16: bool = False) -> str:
    """Decode an EXIF/metadata value. XP* tags are UTF-16LE; UserComment has an 8-byte charset prefix."""
    if isinstance(value, tuple) and all(isinstance(v, int) for v in value):
        value = bytes(v & 0xFF for v in value)
    if isinstance(value, (bytes, bytearray)):
        value = bytes(value)
        if value.startswith(b"UNICODE\x00"):
            value, utf16 = value[8:], True
        elif value.startswith((b"ASCII\x00\x00\x00", b"JIS\x00\x00\x00\x00\x00", b"\x00" * 8)):
            value = value[8:]
        for enc in (("utf-16-le",) if utf16 and len(value) % 2 == 0 else ()) + ("utf-8", "latin-1"):
            try:
                return value.decode(enc).replace("\x00", " ").strip()
            except UnicodeDecodeError:
                continue
        return ""
    return str(value).strip()


def metadata_findings(
    img: Image.Image | None,
    location: str,
    *,
    carried: bool,
    institutions: list[str] | tuple[str, ...] = (),
) -> list[Finding]:
    """Findings for metadata embedded in an image.

    ``carried`` is True when the original bytes are kept in the derivative (so the
    metadata travels with it); False when the image is converted (metadata dropped).
    """
    if img is None:
        return []
    present: list[str] = []
    texts: list[tuple[str, str]] = []
    gps = False
    names: list[str] = []
    serials: list[str] = []
    dates: list[str] = []
    try:
        exif = img.getexif()
    except Exception:  # noqa: BLE001
        exif = None
    if exif:
        for tag, label in _EXIF_TEXT_TAGS.items():
            text = _as_text(exif.get(tag, ""), utf16=label.startswith("XP"))
            if text:
                texts.append((label, text))
        for tag, label in _EXIF_NAME_TAGS.items():
            if _as_text(exif.get(tag, ""), utf16=label.startswith("XP")):
                names.append(label)
        for tag, label in _EXIF_DATES.items():
            if _as_text(exif.get(tag, "")):
                dates.append(label)
        try:
            gps_ifd = exif.get_ifd(0x8825)
            gps = bool(gps_ifd)
        except Exception:  # noqa: BLE001
            gps = 0x8825 in exif
        try:
            exif_ifd = exif.get_ifd(0x8769)
        except Exception:  # noqa: BLE001
            exif_ifd = {}
        for tag, label in _EXIF_IFD_TEXT.items():
            text = _as_text(exif_ifd.get(tag, ""))
            if text:
                texts.append((label, text))
        for tag, label in _EXIF_IFD_NAME.items():
            if _as_text(exif_ifd.get(tag, "")):
                names.append(label)
        for tag, label in _EXIF_IFD_SERIAL.items():
            if _as_text(exif_ifd.get(tag, "")):
                serials.append(label)
        for tag, label in _EXIF_IFD_DATES.items():
            if _as_text(exif_ifd.get(tag, "")):
                dates.append(label)
        if exif.get(0x010F) or exif.get(0x0110):
            present.append("device make/model")
    info = getattr(img, "info", {}) or {}
    comment = info.get("comment")
    if comment:
        texts.append(("comment", _as_text(comment)))
    xmp = info.get("xmp") or info.get("XML:com.adobe.xmp")
    if xmp:
        texts.append(("XMP", _as_text(xmp) if isinstance(xmp, bytes) else str(xmp)))
    png_text = {}
    try:
        png_text = dict(getattr(img, "text", {}) or {})
    except Exception:  # noqa: BLE001
        png_text = {}
    for key, value in png_text.items():
        if key == "XML:com.adobe.xmp":
            continue
        texts.append((f"PNG text '{key[:20]}'" if key.isascii() and key.isprintable() else "PNG text", _as_text(value)))

    any_meta = bool(texts or gps or names or serials or dates or present)
    if not any_meta:
        return []
    if not carried:
        return [
            Finding(
                "low",
                location,
                "embedded metadata (EXIF/XMP/text) present in the source image; not carried into the converted PNG",
                category="metadata",
                scope="source_only",
            )
        ]
    findings: list[Finding] = []
    tail = " (kept in the original bytes; remove before approval or replace the image)"
    if gps:
        findings.append(Finding("high", location, "GPS location metadata present" + tail, "metadata", "content"))
    if names:
        findings.append(Finding("medium", location, "author/owner name metadata present" + tail, "metadata", "content"))
    if serials:
        findings.append(Finding("medium", location, "device serial / unique-ID metadata present" + tail, "metadata", "content"))
    if dates:
        findings.append(Finding("medium", location, "capture date/time metadata present" + tail, "metadata", "content"))
    flagged_any = False
    for label, text in texts:
        found = scan_text(text, location, institutions=institutions, scope="content", category="metadata", what=f"{label} metadata")
        if found:
            flagged_any = True
            findings.extend(found)
    plain = [label for label, text in texts if text]
    if plain and not flagged_any:
        findings.append(
            Finding("medium", location, f"free-text metadata present ({len(plain)} field(s))" + tail, "metadata", "content")
        )
    if present and not findings:
        findings.append(Finding("low", location, "device make/model metadata present", "metadata", "content"))
    return findings


def build_image_item(
    index: int,
    data: bytes,
    origin: str,
    location: str,
    institutions: list[str] | tuple[str, ...] = (),
    detected: str | None = None,
):
    """Probe one embedded/standalone image and attach content-level findings."""
    from ingest.detect import detect_bytes
    from ingest.model import ImageItem
    from ingest.util import sha256_bytes

    detected = detected or detect_bytes(data)
    info, img = probe_image(data, detected)
    item = ImageItem(index=index, data=data, sha256=sha256_bytes(data), info=info, origin=origin)
    item.findings.extend(metadata_findings(img, location, carried=info.browser_displayable, institutions=institutions))
    if info.corner_text_risk:
        item.findings.append(
            Finding(
                "medium",
                location,
                "possible burned-in text in image corners (heuristic, not OCR): review pixels",
                "pixel_text",
                "content",
            )
        )
    if info.grayscale_content is False:
        item.findings.append(
            Finding(
                "low",
                location,
                "colour image: may be a clinical photograph or colour map; check for faces, tattoos or other recognisable features",
                "recognizable_features",
                "content",
            )
        )
    if info.exif_orientation not in (None, 1):
        item.fidelity_notes.append(
            f"EXIF orientation {info.exif_orientation}: displayed orientation differs from stored pixel order; verify left/right"
        )
    if info.width and info.height and min(info.width, info.height) < 256:
        item.notes.append("low resolution (smaller than 256 px)")
    return item, img


# ---------------------------------------------------------------------------
# Lossless conversion to PNG
# ---------------------------------------------------------------------------


@dataclass
class PngFrame:
    data: bytes
    width: int
    height: int


def _to_png_mode(frame: Image.Image, notes: list[str]) -> tuple[Image.Image, bool]:
    """Return (image in a PNG-writable mode, lossless?)."""
    mode = frame.mode
    if mode in ("1", "L", "LA", "P", "RGB", "RGBA", "I;16", "I;16B"):
        return frame, True
    if mode in ("I;16L", "I;16N"):
        return Image.fromarray(np.asarray(frame).astype(np.uint16)), True
    if mode == "I":
        arr = np.asarray(frame)
        if arr.min() >= 0 and arr.max() <= 65535:
            return Image.fromarray(arr.astype(np.uint16)), True
        raise ConversionError("32-bit integer image with values outside 0..65535 cannot be stored losslessly as PNG")
    if mode == "F":
        raise ConversionError("32-bit float image cannot be stored losslessly as PNG; not converted")
    if mode in ("PA", "RGBa"):
        return frame.convert("RGBA"), True
    if mode == "RGBX":
        return frame.convert("RGB"), True
    if mode in ("CMYK", "YCbCr", "LAB", "HSV"):
        notes.append(f"{mode} colour converted to RGB (colour-space conversion is not bit-exact)")
        return frame.convert("RGB"), False
    raise ConversionError(f"image mode {mode} is not supported for PNG conversion")


def convert_to_png_frames(data: bytes, detected: str) -> tuple[list[PngFrame], list[str], bool]:
    """Decode every frame and re-encode as PNG without resampling or cropping.

    Returns (frames, notes, lossless). Raises ConversionError when that is impossible.
    """
    if detected in UNSUPPORTED_REASONS:
        raise ConversionError(UNSUPPORTED_REASONS[detected])
    try:
        img = open_image(data)
    except Exception as exc:  # noqa: BLE001
        raise ConversionError(f"image could not be decoded ({type(exc).__name__})") from exc
    notes: list[str] = []
    lossless = True
    n_frames = int(getattr(img, "n_frames", 1) or 1)
    icc = img.info.get("icc_profile")
    if detected == "tiff":
        try:
            bps = img.tag_v2.get(258)
            if isinstance(bps, tuple) and img.mode in ("RGB", "RGBA") and max(bps) > 8:
                notes.append("16-bit-per-channel colour TIFF was reduced to 8 bits by the decoder (not lossless)")
                lossless = False
        except Exception:  # noqa: BLE001
            pass
        if img.info.get("compression") in ("jpeg", "tiff_jpeg"):
            notes.append("TIFF used JPEG compression internally; PNG stores the decoded pixels exactly")
    if detected in ("jpeg", "webp", "jp2", "avif"):
        notes.append(f"{detected.upper()} decoded and stored as PNG (PNG is exact to the decoded pixels)")
    frames: list[PngFrame] = []
    for i in range(n_frames):
        if n_frames > 1:
            img.seek(i)
        frame = img.copy()
        if n_frames == 1:
            orientation = None
            try:
                orientation = img.getexif().get(0x0112)
            except Exception:  # noqa: BLE001
                pass
            if orientation and orientation != 1:
                frame = ImageOps.exif_transpose(frame)
                notes.append(f"orientation tag {orientation} applied by lossless transpose so the PNG displays as the original")
        frame, ok = _to_png_mode(frame, notes)
        lossless = lossless and ok
        buf = io.BytesIO()
        params = {"format": "PNG"}
        if icc:
            params["icc_profile"] = icc
        frame.save(buf, **params)
        frames.append(PngFrame(buf.getvalue(), frame.size[0], frame.size[1]))
    return frames, sorted(set(notes), key=notes.index), lossless


# ---------------------------------------------------------------------------
# Optional lossless metadata stripping (segment/chunk level, pixels untouched)
# ---------------------------------------------------------------------------

_JPEG_KEEP_APP = {0xE0, 0xEE}  # JFIF, Adobe (colour transform); ICC handled below
_PNG_DROP_CHUNKS = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}


def strip_jpeg_metadata(data: bytes) -> bytes | None:
    """Drop APP1 (EXIF/XMP), APP3-APP13, APP15 and COM segments; keep JFIF, ICC, Adobe and
    all image data. Returns None if the stream cannot be parsed safely."""
    if not data.startswith(b"\xff\xd8"):
        return None
    out = bytearray(b"\xff\xd8")
    i = 2
    n = len(data)
    while i < n:
        if data[i] != 0xFF:
            return None
        while i < n and data[i] == 0xFF:
            i += 1
        if i >= n:
            return None
        marker = data[i]
        i += 1
        if marker == 0xDA:  # start of scan: copy image data verbatim up to and including EOI
            rest = data[i:]
            eoi = rest.find(b"\xff\xd9")  # inside entropy-coded data 0xFF is always stuffed
            if eoi < 0:
                return None
            out += b"\xff\xda" + rest[: eoi + 2]  # trailing data (e.g. MPO previews) dropped
            return bytes(out)
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            out += bytes([0xFF, marker])
            continue
        if i + 2 > n:
            return None
        (length,) = struct.unpack(">H", data[i : i + 2])
        segment = data[i : i + length]
        if len(segment) != length or length < 2:
            return None
        keep = True
        if marker == 0xFE or 0xE1 <= marker <= 0xEF:
            keep = marker in _JPEG_KEEP_APP or (marker == 0xE2 and segment[2:14] == b"ICC_PROFILE\x00")
        if keep:
            out += bytes([0xFF, marker]) + segment
        i += length
    return None


def strip_png_metadata(data: bytes) -> bytes | None:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    out = bytearray(data[:8])
    i = 8
    while i + 8 <= len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        ctype = data[i + 4 : i + 8]
        end = i + 12 + length
        if end > len(data):
            return None
        if ctype not in _PNG_DROP_CHUNKS:
            out += data[i:end]
        i = end
        if ctype == b"IEND":
            return bytes(out)
    return None
