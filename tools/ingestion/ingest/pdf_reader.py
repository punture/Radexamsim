"""PDF analysis: embedded image streams, overlays drawn on top of them, identifier checks.

JPEG (DCTDecode) streams are extracted byte-for-byte as original images. Other streams
(Flate, LZW, CCITT, JPEG 2000 ...) have no standalone file format and are decoded and
stored as lossless PNG. Vector shapes or annotations drawn over an image are NOT applied
to the extracted image; opaque ones are flagged because they may be redaction boxes.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.generic import ContentStream

from ingest.images import build_image_item
from ingest.model import Finding, ImageItem, SourceFile, SourceResult, Unit
from ingest.phi import scan_text
from ingest.pptx_reader import Box
from ingest.util import sha256_bytes

logging.getLogger("pypdf").setLevel(logging.ERROR)

LOSSLESS_FILTERS = {"/FlateDecode", "/Fl", "/LZWDecode", "/LZW", "/ASCII85Decode", "/A85", "/ASCIIHexDecode", "/AHx", "/RunLengthDecode", "/RL"}
MARKUP_ANNOTS = {"/Square", "/Circle", "/Line", "/Polygon", "/PolyLine", "/Ink", "/FreeText", "/Text", "/Stamp", "/Highlight", "/Underline", "/StrikeOut", "/Squiggly", "/Caret"}

IDENTITY = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]


def _mul(m1, m2):
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return [
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    ]


def _apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def _box_of(points) -> Box:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return Box(min(xs), min(ys), max(xs), max(ys))


def _overlaps(a: Box, b: Box) -> bool:
    return a.x0 <= b.x1 and b.x0 <= a.x1 and a.y0 <= b.y1 and b.y0 <= a.y1


@dataclass
class Placement:
    key: object  # pypdf image key: "/Im0", ["/Fm0", "/Im1"] or "~0~"
    xobj: object
    box: Box
    order: int


@dataclass
class Mark:
    kind: str  # fill_rect | fill_other | stroke | text
    box: Box
    order: int


def _floats(operands) -> list[float]:
    return [float(x) for x in operands]


def interpret_page(page, reader) -> tuple[list[Placement], list[Mark], bool]:
    """Track the CTM through the content stream to find where images and marks are drawn."""
    placements: list[Placement] = []
    marks: list[Mark] = []
    counter = [0]
    inline = [0]
    ok = [True]

    def nxt() -> int:
        counter[0] += 1
        return counter[0]

    def run(content, resources, ctm, prefix, depth):
        if depth > 8:
            return
        try:
            ops = ContentStream(content, reader).operations
        except Exception:  # noqa: BLE001
            ok[0] = False
            return
        xobjects = {}
        try:
            if resources is not None and "/XObject" in resources:
                xobjects = resources["/XObject"].get_object()
        except Exception:  # noqa: BLE001
            xobjects = {}
        gstack = []
        path: list[tuple[float, float]] = []
        rect_only = True
        tm = None
        tline = None
        for operands, op in ops:
            try:
                if op == b"q":
                    gstack.append(ctm)
                elif op == b"Q":
                    ctm = gstack.pop() if gstack else ctm
                elif op == b"cm" and len(operands) == 6:
                    ctm = _mul(_floats(operands), ctm)
                elif op == b"re" and len(operands) == 4:
                    x, y, w, h = _floats(operands)
                    path += [_apply(ctm, x, y), _apply(ctm, x + w, y), _apply(ctm, x, y + h), _apply(ctm, x + w, y + h)]
                elif op in (b"m", b"l") and len(operands) == 2:
                    path.append(_apply(ctm, *_floats(operands)))
                    rect_only = False
                elif op in (b"c", b"v", b"y"):
                    vals = _floats(operands)
                    path += [_apply(ctm, vals[i], vals[i + 1]) for i in range(0, len(vals) - 1, 2)]
                    rect_only = False
                elif op in (b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*"):
                    if path:
                        marks.append(Mark("fill_rect" if rect_only else "fill_other", _box_of(path), nxt()))
                    path, rect_only = [], True
                elif op in (b"S", b"s"):
                    if path:
                        marks.append(Mark("stroke", _box_of(path), nxt()))
                    path, rect_only = [], True
                elif op == b"n":
                    path, rect_only = [], True
                elif op == b"BT":
                    tm = list(IDENTITY)
                    tline = list(IDENTITY)
                elif op == b"ET":
                    tm = None
                elif op == b"Tm" and len(operands) == 6:
                    tm = tline = _floats(operands)
                elif op in (b"Td", b"TD") and len(operands) == 2 and tline is not None:
                    tx, ty = _floats(operands)
                    tline = _mul([1, 0, 0, 1, tx, ty], tline)
                    tm = tline
                elif op in (b"Tj", b"TJ", b"'", b'"') and tm is not None:
                    x, y = _apply(_mul(tm, ctm), 0, 0)
                    marks.append(Mark("text", Box(x, y, x, y), nxt()))
                elif op == b"Do" and operands:
                    name = operands[0]
                    xo = xobjects[name].get_object() if name in xobjects else None
                    if xo is None:
                        continue
                    subtype = xo.get("/Subtype")
                    if subtype == "/Image":
                        pts = [_apply(ctm, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
                        key = str(name) if not prefix else [*prefix, str(name)]
                        placements.append(Placement(key, xo, _box_of(pts), nxt()))
                    elif subtype == "/Form":
                        matrix = _floats(xo.get("/Matrix", IDENTITY))
                        form_res = xo.get("/Resources")
                        form_res = form_res.get_object() if form_res is not None else resources
                        run(xo, form_res, _mul(matrix, ctm), [*prefix, str(name)], depth + 1)
                elif op == b"INLINE IMAGE":
                    if not prefix:
                        pts = [_apply(ctm, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
                        placements.append(Placement(f"~{inline[0]}~", None, _box_of(pts), nxt()))
                        inline[0] += 1
            except Exception:  # noqa: BLE001 - malformed operator: keep going
                continue

    contents = page.get_contents()
    if contents is not None:
        resources = page.get("/Resources")
        run(contents, resources.get_object() if resources is not None else None, list(IDENTITY), [], 0)
    return placements, marks, ok[0]


def _filters(xobj) -> list[str]:
    f = xobj.get("/Filter")
    if f is None:
        return []
    f = f.get_object() if hasattr(f, "get_object") else f
    if isinstance(f, (list, tuple)):
        return [str(x) for x in f]
    return [str(f)]


def analyze_pdf(src: SourceFile, data: bytes, institutions: list[str] | tuple[str, ...] = ()) -> SourceResult:
    result = SourceResult(source=src)
    sid = src.sid
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    result.unsupported_reason = "encrypted PDF (password required); not processed"
                    return result
            except Exception:  # noqa: BLE001
                result.unsupported_reason = "encrypted PDF could not be opened; not processed"
                return result
        pages = list(reader.pages)
    except Exception as exc:  # noqa: BLE001
        result.unsupported_reason = f"PDF could not be parsed ({type(exc).__name__})"
        return result

    try:
        meta = reader.metadata or {}
    except Exception:  # noqa: BLE001
        meta = {}
    if meta:
        if any(str(meta.get(k, "") or "").strip() for k in ("/Author", "/Creator")):
            result.findings.append(Finding("low", "document properties", "PDF author/creator metadata present", "text", "source_text"))
        for key in ("/Title", "/Subject", "/Keywords", "/Author"):
            value = meta.get(key)
            if value and str(value).strip():
                result.findings.extend(
                    scan_text(str(value), "document properties", institutions=institutions, what=f"PDF {key[1:].lower()}")
                )
    try:
        if reader.xmp_metadata is not None:
            result.notes.append("PDF has XMP metadata (not inspected in detail)")
    except Exception:  # noqa: BLE001
        pass

    for n, page in enumerate(pages, start=1):
        try:
            unit = _analyze_page(page, reader, n, sid, institutions)
        except Exception as exc:  # noqa: BLE001
            unit = Unit(kind="pdf_page", source_id=sid, locator=f"page {n}")
            unit.missing.append(f"page could not be analysed ({type(exc).__name__})")
            unit.label = f"PDF {sid[:8]} page {n}: not analysed"
        unit.source_files = [src]
        result.units.append(unit)
    return result


def _analyze_page(page, reader, n: int, sid: str, institutions) -> Unit:
    unit = Unit(kind="pdf_page", source_id=sid, locator=f"page {n}")
    loc = f"page {n}"
    segments: list[tuple[str, str]] = []
    try:
        text = page.extract_text() or ""
    except Exception:  # noqa: BLE001
        text = ""
        unit.notes.append("page text could not be extracted")
    if text.strip():
        segments.append((f"{loc} text", text))

    annots = []
    try:
        raw_annots = page.get("/Annots")
        raw_annots = raw_annots.get_object() if raw_annots is not None else []
        for a in raw_annots or []:
            a = a.get_object()
            subtype = str(a.get("/Subtype", ""))
            rect = [float(x) for x in a.get("/Rect", [0, 0, 0, 0])]
            box = Box(min(rect[0], rect[2]), min(rect[1], rect[3]), max(rect[0], rect[2]), max(rect[1], rect[3]))
            annots.append((subtype, box, a))
            words = " ".join(str(a.get(k, "") or "") for k in ("/Contents", "/T", "/Subj")).strip()
            if words:
                segments.append((f"{loc} annotations", words))
    except Exception:  # noqa: BLE001
        unit.notes.append("page annotations could not be read")

    for location, seg in segments:
        unit.findings.extend(scan_text(seg, location, institutions=institutions, what=location.split(" ", 2)[-1]))
    unit.text_segments = segments

    placements, marks, parsed = interpret_page(page, reader)
    if not parsed:
        unit.notes.append("content stream could not be fully parsed; overlay checks incomplete")

    images: list[ImageItem] = []
    seen_streams: dict[int, ImageItem] = {}
    annotated = False
    for pl in placements:
        ref = getattr(pl.xobj, "indirect_reference", None) if pl.xobj is not None else None
        stream_key = (ref.idnum, ref.generation) if ref is not None else None
        if stream_key is not None and stream_key in seen_streams:
            item = seen_streams[stream_key]
        else:
            item = _extract_image(page, pl, len(images), loc, institutions, unit)
            if item is None:
                continue
            images.append(item)
            if stream_key is not None:
                seen_streams[stream_key] = item
        img_loc = f"{loc} image {item.index + 1}"
        area = pl.box.area
        for mk in marks:
            if mk.order < pl.order or not _overlaps(pl.box, mk.box):
                continue
            inter = pl.box.intersection(mk.box)
            if mk.kind == "stroke":
                if area > 0 and mk.box.area >= 0.9 * area:
                    continue  # frame around the image, not an annotation
                annotated = True
                item.notes.append("vector line/arrow drawn over the image on the page (not in the extracted image)")
            elif mk.kind == "text":
                annotated = True
                item.notes.append("text label drawn over the image on the page (not in the extracted image)")
            elif area > 0 and ((mk.kind == "fill_rect" and inter >= 0.005 * area) or inter >= 0.05 * area):
                item.findings.append(
                    Finding(
                        "high",
                        img_loc,
                        "opaque vector shape drawn over the image (possible redaction box); the extracted image stream does NOT include it - review the covered region",
                        "overlay",
                        "content",
                    )
                )
            else:
                annotated = True
                item.notes.append("vector shape drawn over the image on the page (not in the extracted image)")
        for subtype, box, a in annots:
            if not _overlaps(pl.box, box):
                continue
            if subtype == "/Redact":
                item.findings.append(
                    Finding("high", img_loc, "unapplied redaction annotation over the image; the image stream still contains the content", "overlay", "content")
                )
            elif subtype in ("/Square", "/Circle") and a.get("/IC") and area > 0 and pl.box.intersection(box) >= 0.005 * area:
                item.findings.append(
                    Finding("high", img_loc, "filled annotation covers part of the image (possible redaction box); not applied to the extracted image", "overlay", "content")
                )
            elif subtype in MARKUP_ANNOTS:
                annotated = True
                item.notes.append(f"PDF annotation {subtype[1:]} over the image (not in the extracted image)")
    for item in images:
        item.notes = sorted(set(item.notes), key=item.notes.index)
        unit.findings.extend(item.findings)
    unit.images = images
    unit.teaching_annotations = annotated if images else None
    unit.label = f"PDF {sid[:8]} page {n}: {len(images)} image(s)" + (", teaching annotations" if annotated else "")
    if not images:
        unit.notes.append("no images on page")
    return unit


def _extract_image(page, pl: Placement, idx: int, loc: str, institutions, unit: Unit) -> ImageItem | None:
    img_loc = f"{loc} image {idx + 1}"
    xobj = pl.xobj
    if xobj is not None:
        filters = _filters(xobj)
        last = filters[-1] if filters else None
        others_lossless = all(f in LOSSLESS_FILTERS for f in filters[:-1])
        if last in ("/DCTDecode", "/DCT") and others_lossless:
            raw = xobj.get_data()
            item, _ = build_image_item(idx, raw, "pdf_dct", img_loc, institutions, detected="jpeg")
            if "/SMask" in xobj or "/Mask" in xobj:
                item.notes.append("PDF applies a transparency mask to this JPEG; the original JPEG stream is extracted without it")
            if "/Decode" in xobj:
                item.fidelity_notes.append("PDF /Decode array present: the page may display this JPEG with inverted/remapped values")
            if "/ColorSpace" in xobj and "CMYK" in str(xobj.get("/ColorSpace")):
                item.notes.append("CMYK JPEG stream")
            return item
        if last == "/JPXDecode" and others_lossless:
            raw = xobj.get_data()
            item, _ = build_image_item(idx, raw, "pdf_jpx", img_loc, institutions, detected="jp2")
            if not item.info.decodable:
                unit.missing.append(f"image {idx + 1}: JPEG 2000 stream could not be decoded")
            return item
        if last in ("/JBIG2Decode",):
            unit.missing.append(f"image {idx + 1}: JBIG2 image stream is not supported")
            return None
    try:
        image_file = page.images[pl.key]
        pil = image_file.image
    except Exception as exc:  # noqa: BLE001
        unit.missing.append(f"image {idx + 1}: PDF image stream could not be decoded ({type(exc).__name__})")
        return None
    if pil is None:
        unit.missing.append(f"image {idx + 1}: PDF image stream could not be decoded")
        return None
    buf = io.BytesIO()
    try:
        save_img = pil if pil.mode in ("1", "L", "LA", "P", "RGB", "RGBA", "I;16") else pil.convert("RGBA" if "A" in pil.mode else "RGB")
        save_img.save(buf, format="PNG")
    except Exception as exc:  # noqa: BLE001
        unit.missing.append(f"image {idx + 1}: decoded PDF image could not be stored as PNG ({type(exc).__name__})")
        return None
    png = buf.getvalue()
    item, _ = build_image_item(idx, png, "pdf_decoded", img_loc, institutions, detected="png")
    raw_hash = None
    if xobj is not None:
        try:
            raw_hash = sha256_bytes(xobj.get_data())
        except Exception:  # noqa: BLE001
            raw_hash = None
    filters = "/".join(f.lstrip("/") for f in _filters(xobj)) if xobj is not None else "inline"
    item.notes.append(f"PDF image stream ({filters or 'unfiltered'}) decoded by pypdf and stored as lossless PNG")
    if raw_hash:
        item.notes.append(f"SHA-256 of the decoded stream samples: {raw_hash}")
    if pil.mode != save_img.mode:
        item.notes.append(f"pixel mode {pil.mode} converted to {save_img.mode}")
    return item
