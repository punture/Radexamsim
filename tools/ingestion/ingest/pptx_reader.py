"""PPTX analysis: original embedded media, teaching annotations and identifier checks.

Original pictures are taken from the image parts (``ppt/media/*``) byte-for-byte; slide
crops, flips and recolouring are display-only in PowerPoint and are reported, not applied.
Slide text, notes, comments, alt text and document properties are scanned for identifier
patterns; raw text stays in memory unless the owner passes ``--include-source-text``.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

from lxml import etree
from pptx.opc.constants import CONTENT_TYPE as CT
from pptx.package import Package

from ingest.detect import check_zip_safety, video_mime
from ingest.images import build_image_item
from ingest.model import Finding, ImageItem, ImageInfo, SourceFile, SourceResult, Unit
from ingest.phi import scan_text
from ingest.util import sha256_bytes

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
}


def q(tag: str) -> str:
    prefix, local = tag.split(":")
    return f"{{{NS[prefix]}}}{local}"


def qp(*tags: str) -> str:
    return "/".join(q(t) for t in tags)


R_EMBED = q("r:embed")
R_LINK = q("r:link")

SAFE_PARSER = etree.XMLParser(
    resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False, remove_comments=True
)

PRESENTATION_TYPES = {CT.PML_PRESENTATION_MAIN, CT.PML_PRES_MACRO_MAIN, CT.PML_TEMPLATE_MAIN, CT.PML_SLIDESHOW_MAIN}

ARROW_PRESETS = {
    "rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow", "quadArrow",
    "leftRightUpArrow", "bentArrow", "uturnArrow", "leftUpArrow", "bentUpArrow", "curvedRightArrow",
    "curvedLeftArrow", "curvedUpArrow", "curvedDownArrow", "stripedRightArrow", "notchedRightArrow",
    "chevron", "homePlate", "circularArrow", "leftCircularArrow", "leftRightCircularArrow", "swooshArrow",
    "rightArrowCallout", "leftArrowCallout", "upArrowCallout", "downArrowCallout", "leftRightArrowCallout",
    "upDownArrowCallout", "quadArrowCallout",
}
CALLOUT_PRESETS = {
    "wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "cloudCallout",
    "borderCallout1", "borderCallout2", "borderCallout3", "accentCallout1", "accentCallout2",
    "accentCallout3", "callout1", "callout2", "callout3", "accentBorderCallout1", "accentBorderCallout2",
    "accentBorderCallout3",
}
LINE_PRESETS = {
    "line", "lineInv", "straightConnector1", "bentConnector2", "bentConnector3", "bentConnector4",
    "bentConnector5", "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5",
}
BLIP_EFFECTS = {"lum", "grayscl", "biLevel", "duotone", "clrChange", "alphaModFix", "clrRepl", "hsl", "tint"}
DEFAULT_NAME_RE = re.compile(r"^(?:[A-Za-z][A-Za-z ]*\s\d+|Google Shape;\d+;.*|)$")

REL_COMMENTS = ("/relationships/comments",)
REL_CHART = "/relationships/chart"
REL_DIAGRAM_DATA = "/relationships/diagramData"
REL_OLE = ("/relationships/oleObject", "/relationships/package")
REL_HYPERLINK = "/relationships/hyperlink"


@dataclass
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def area(self) -> float:
        return max(0.0, self.x1 - self.x0) * max(0.0, self.y1 - self.y0)

    def intersection(self, other: "Box") -> float:
        w = min(self.x1, other.x1) - max(self.x0, other.x0)
        h = min(self.y1, other.y1) - max(self.y0, other.y0)
        return w * h if w > 0 and h > 0 else 0.0


@dataclass
class ShapeRec:
    el: object
    tag: str
    box: Box | None
    z: int
    role: str  # picture | annotation | overlay | other
    detail: str


def open_presentation(data: bytes):
    """Open .pptx/.pptm/.potx/.ppsx from bytes (no file name is ever passed to the parser)."""
    pkg = Package.open(io.BytesIO(data))
    part = pkg.main_document_part
    if part.content_type not in PRESENTATION_TYPES:
        raise ValueError("not a PowerPoint presentation package")
    return pkg, part.presentation


def _int(v, default=0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _box_from_xfrm(xfrm, t) -> Box | None:
    if xfrm is None:
        return None
    off, ext = xfrm.find(q("a:off")), xfrm.find(q("a:ext"))
    if off is None or ext is None:
        return None
    x, y = _int(off.get("x")), _int(off.get("y"))
    cx, cy = _int(ext.get("cx")), _int(ext.get("cy"))
    sx, sy, tx, ty = t
    x0, y0, x1, y1 = sx * x + tx, sy * y + ty, sx * (x + cx) + tx, sy * (y + cy) + ty
    return Box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def _group_transform(grp, t):
    xfrm = grp.find(qp("p:grpSpPr", "a:xfrm"))
    if xfrm is None:
        return t
    parts = [xfrm.find(q(n)) for n in ("a:off", "a:ext", "a:chOff", "a:chExt")]
    if any(p is None for p in parts):
        return t
    off, ext, choff, chext = parts
    x, y, cx, cy = _int(off.get("x")), _int(off.get("y")), _int(ext.get("cx")), _int(ext.get("cy"))
    chx, chy, chcx, chcy = _int(choff.get("x")), _int(choff.get("y")), _int(chext.get("cx")), _int(chext.get("cy"))
    gsx = cx / chcx if chcx else 1.0
    gsy = cy / chcy if chcy else 1.0
    gtx, gty = x - chx * gsx, y - chy * gsy
    sx, sy, tx, ty = t
    return (sx * gsx, sy * gsy, sx * gtx + tx, sy * gty + ty)


def _fill_state(el) -> str:
    sppr = el.find(q("p:spPr"))
    if sppr is not None:
        if sppr.find(q("a:noFill")) is not None:
            return "none"
        solid = sppr.find(q("a:solidFill"))
        if solid is not None:
            alpha = solid.find(".//" + q("a:alpha"))
            if alpha is not None and _int(alpha.get("val"), 100000) < 90000:
                return "translucent"
            return "opaque"
        for tag in ("a:gradFill", "a:pattFill", "a:blipFill", "a:grpFill"):
            if sppr.find(q(tag)) is not None:
                return "opaque"
    style = el.find(q("p:style"))
    if style is not None:
        ref = style.find(q("a:fillRef"))
        if ref is not None and ref.get("idx", "0") != "0":
            return "opaque"
    return "none"


def _classify(el, tag: str) -> tuple[str, str]:
    if tag == "pic":
        return "picture", "picture"
    if tag == "cxnSp":
        ln = el.find(qp("p:spPr", "a:ln"))
        arrow = False
        if ln is not None:
            for end in (ln.find(q("a:headEnd")), ln.find(q("a:tailEnd"))):
                if end is not None and end.get("type", "none") != "none":
                    arrow = True
        return "annotation", "arrow" if arrow else "line"
    if tag == "contentPart":
        return "annotation", "ink"
    if tag == "graphicFrame":
        return "other", "table/chart/object"
    sppr = el.find(q("p:spPr"))
    if sppr is not None and sppr.find(q("a:blipFill")) is not None:
        return "picture", "image-filled shape"
    geom = sppr.find(q("a:prstGeom")) if sppr is not None else None
    prst = geom.get("prst") if geom is not None else None
    cnv = el.find(qp("p:nvSpPr", "p:cNvSpPr"))
    is_txbox = cnv is not None and cnv.get("txBox") == "1"
    is_placeholder = el.find(qp("p:nvSpPr", "p:nvPr", "p:ph")) is not None
    has_text = any((t.text or "").strip() for t in el.iter(q("a:t")))
    fill = _fill_state(el)
    if prst in ARROW_PRESETS:
        return "annotation", "arrow"
    if prst in CALLOUT_PRESETS:
        return "annotation", "callout"
    if prst in LINE_PRESETS:
        return "annotation", "line"
    if is_txbox or is_placeholder:
        if fill == "opaque":
            return "overlay", "opaque text box"
        return ("annotation", "text label") if has_text else ("other", "empty text box")
    if fill == "opaque":
        return "overlay", f"opaque {prst or 'freeform'} shape"
    return "annotation", f"outline {prst or 'freeform'}"


def _shape_box(el, tag: str, t, ph_geometry: dict[str, tuple[int, int, int, int]]) -> Box | None:
    if tag == "graphicFrame":
        xfrm = el.find(q("p:xfrm"))
    elif tag == "contentPart":
        xfrm = el.find(q("p14:xfrm"))
    else:
        xfrm = el.find(qp("p:spPr", "a:xfrm"))
    box = _box_from_xfrm(xfrm, t)
    if box is None:
        cnv = el.find(".//" + q("p:cNvPr"))
        geom = ph_geometry.get(cnv.get("id")) if cnv is not None else None
        if geom and all(v is not None for v in geom):
            left, top, width, height = geom
            sx, sy, tx, ty = t
            box = Box(sx * left + tx, sy * top + ty, sx * (left + width) + tx, sy * (top + height) + ty)
    return box


def _walk(container, t, out: list[ShapeRec], counter: list[int], ph_geometry, depth: int = 0) -> None:
    if depth > 20:
        return
    for child in container:
        if not isinstance(child.tag, str):
            continue
        local = etree.QName(child).localname
        if local == "grpSp":
            _walk(child, _group_transform(child, t), out, counter, ph_geometry, depth + 1)
        elif local in ("sp", "pic", "cxnSp", "graphicFrame", "contentPart"):
            counter[0] += 1
            role, detail = _classify(child, local)
            out.append(ShapeRec(child, local, _shape_box(child, local, t, ph_geometry), counter[0], role, detail))
        elif local == "AlternateContent":
            branch = child.find(q("mc:Choice"))
            if branch is None:
                branch = child.find(q("mc:Fallback"))
            if branch is not None:
                _walk(branch, t, out, counter, ph_geometry, depth + 1)


def _paragraph_text(root) -> str:
    lines = []
    for p in root.iter(q("a:p")):
        line = "".join(t.text or "" for t in p.iter(q("a:t")))
        if line.strip():
            lines.append(line)
    return "\n".join(lines)


def _xml_text(blob: bytes, local_names: tuple[str, ...]) -> str:
    try:
        root = etree.fromstring(blob, SAFE_PARSER)
    except etree.XMLSyntaxError:
        return ""
    parts = []
    for el in root.iter():
        if isinstance(el.tag, str) and etree.QName(el).localname in local_names and el.text and el.text.strip():
            parts.append(el.text.strip())
    return "\n".join(parts)


def _rel_blob(part, rid: str) -> tuple[bytes | None, bool, str | None]:
    """Return (blob, is_external, partname) for a relationship id."""
    try:
        rel = part.rels[rid]
    except KeyError:
        return None, False, None
    if rel.is_external:
        return None, True, None
    target = rel.target_part
    return target.blob, False, str(target.partname)


def _flips(el) -> tuple[bool, bool, int]:
    fh = fv = False
    rot = 0
    nodes = [el.find(qp("p:spPr", "a:xfrm"))]
    nodes += [g.find(qp("p:grpSpPr", "a:xfrm")) for g in el.iterancestors(q("p:grpSp"))]
    for x in nodes:
        if x is None:
            continue
        fh ^= x.get("flipH") in ("1", "true")
        fv ^= x.get("flipV") in ("1", "true")
        rot += _int(x.get("rot"))
    return fh, fv, rot % 21600000


def analyze_pptx(src: SourceFile, data: bytes, institutions: list[str] | tuple[str, ...] = ()) -> SourceResult:
    result = SourceResult(source=src)
    sid = src.sid
    reason = check_zip_safety(data)
    if reason:
        result.unsupported_reason = f"PPTX rejected: {reason}"
        return result
    try:
        pkg, prs = open_presentation(data)
    except Exception as exc:  # noqa: BLE001
        result.unsupported_reason = f"PPTX could not be parsed ({type(exc).__name__})"
        return result

    _deck_level_checks(pkg, prs, result, institutions)

    layout_pictures = 0
    for master in prs.slide_masters:
        layout_pictures += len(master._element.findall(".//" + q("p:pic")))
        for layout in master.slide_layouts:
            layout_pictures += len(layout._element.findall(".//" + q("p:pic")))
    if layout_pictures:
        result.notes.append(
            f"{layout_pictures} picture(s) in slide masters/layouts were not extracted (template graphics; may show institution logos)"
        )

    for n, slide in enumerate(prs.slides, start=1):
        try:
            units = _analyze_slide(slide, n, sid, institutions)
        except Exception as exc:  # noqa: BLE001 - one bad slide must not hide the others
            unit = Unit(kind="pptx_slide", source_id=sid, locator=f"slide {n}")
            unit.missing.append(f"slide could not be analysed ({type(exc).__name__})")
            unit.label = f"Deck {sid[:8]} slide {n}: not analysed"
            units = [unit]
        for u in units:
            u.source_files = [src]
        result.units.extend(units)
    return result


def _deck_level_checks(pkg, prs, result: SourceResult, institutions) -> None:
    location = "deck properties"
    cp = prs.core_properties
    people = [v for v in (cp.author, cp.last_modified_by) if v and str(v).strip()]
    if people:
        result.findings.append(
            Finding("low", location, "document author / last-modified-by names present", "text", "source_text")
        )
    for field_name in ("title", "subject", "keywords", "comments", "category", "content_status", "identifier"):
        value = getattr(cp, field_name, None)
        if value and str(value).strip():
            result.findings.extend(
                scan_text(str(value), location, institutions=institutions, what=f"document {field_name}")
            )
    for part in pkg.iter_parts():
        name = str(part.partname)
        if name == "/docProps/app.xml":
            text = _xml_text(part.blob, ("Company", "Manager"))
            if text:
                result.findings.append(
                    Finding("low", location, "document Company/Manager properties present (may name an institution)", "text", "source_text")
                )
                result.findings.extend(scan_text(text, location, institutions=institutions, what="Company/Manager properties"))
        elif name == "/docProps/custom.xml":
            text = _xml_text(part.blob, ("lpwstr", "lpstr", "bstr"))
            if text:
                result.findings.extend(scan_text(text, location, institutions=institutions, what="custom properties"))
        elif name in ("/ppt/commentAuthors.xml", "/ppt/authors.xml"):
            result.findings.append(
                Finding("low", location, "comment author names present in the deck", "text", "source_text")
            )


def _analyze_slide(slide, n: int, sid: str, institutions) -> list[Unit]:
    unit = Unit(kind="pptx_slide", source_id=sid, locator=f"slide {n}")
    loc = f"slide {n}"
    sld = slide._element
    if sld.get("show") in ("0", "false"):
        unit.notes.append("hidden slide")

    ph_geometry = {}
    for shp in slide.shapes:
        try:
            ph_geometry[str(shp.shape_id)] = (shp.left, shp.top, shp.width, shp.height)
        except Exception:  # noqa: BLE001
            continue

    shapes: list[ShapeRec] = []
    sp_tree = sld.find(qp("p:cSld", "p:spTree"))
    if sp_tree is not None:
        _walk(sp_tree, (1.0, 1.0, 0.0, 0.0), shapes, [0], ph_geometry)

    # ---- text segments (memory only) ----
    segments: list[tuple[str, str]] = []
    slide_text = _paragraph_text(sld)
    if slide_text:
        segments.append((f"{loc} text", slide_text))
    if slide.has_notes_slide:
        notes_text = _paragraph_text(slide.notes_slide._element)
        if notes_text:
            segments.append((f"{loc} notes", notes_text))
    alt_texts, custom_names = [], []
    for cnv in sld.iter(q("p:cNvPr")):
        for attr in ("descr", "title"):
            v = (cnv.get(attr) or "").strip()
            if v:
                alt_texts.append(v)
        name = (cnv.get("name") or "").strip()
        if name and not DEFAULT_NAME_RE.match(name):
            custom_names.append(name)
    if alt_texts:
        segments.append((f"{loc} alt text", "\n".join(alt_texts)))
        unit.findings.append(
            Finding("low", f"{loc} alt text", "alt text/description present (may contain an original file name)", "text", "source_text")
        )
    if custom_names:
        segments.append((f"{loc} shape names", "\n".join(custom_names)))

    other_embedded = 0
    for rel in slide.part.rels.values():
        reltype = rel.reltype or ""
        try:
            if rel.is_external:
                if reltype.endswith(REL_HYPERLINK) and rel.target_ref:
                    segments.append((f"{loc} hyperlinks", str(rel.target_ref)))
                continue
            if reltype.endswith(REL_COMMENTS) or reltype == "http://schemas.microsoft.com/office/2018/10/relationships/comments":
                text = _xml_text(rel.target_part.blob, ("text", "t"))
                if text:
                    segments.append((f"{loc} comments", text))
            elif reltype.endswith(REL_CHART):
                text = _xml_text(rel.target_part.blob, ("v", "t"))
                if text:
                    segments.append((f"{loc} chart text", text))
            elif reltype.endswith(REL_DIAGRAM_DATA):
                text = _xml_text(rel.target_part.blob, ("t",))
                if text:
                    segments.append((f"{loc} SmartArt text", text))
            elif reltype.endswith(REL_OLE):
                other_embedded += 1
        except Exception:  # noqa: BLE001
            continue
    if other_embedded:
        unit.findings.append(
            Finding("medium", loc, f"{other_embedded} embedded object(s) (OLE/package) not inspected; may contain identifiers", "structure", "source_text")
        )
        unit.missing.append(f"{other_embedded} embedded OLE/package object(s) not inspected")

    for location, text in segments:
        unit.findings.extend(scan_text(text, location, institutions=institutions, what=location.split(" ", 2)[-1]))
    unit.text_segments = segments

    # ---- pictures, videos and annotations ----
    pictures = [s for s in shapes if s.role == "picture"]
    annotations = [s for s in shapes if s.role == "annotation"]
    overlays = [s for s in shapes if s.role == "overlay"]
    images: list[ImageItem] = []
    by_part: dict[str, ImageItem] = {}
    pic_items: list[tuple[ShapeRec, ImageItem]] = []
    extracted_rids: set[str] = set()
    videos: list[Unit] = []

    for rec in pictures:
        el = rec.el
        nvpr = el.find(qp("p:nvPicPr", "p:nvPr"))
        video_rids = []
        if nvpr is not None:
            media = nvpr.find(q("a:videoFile"))
            if media is None:
                media = nvpr.find(q("a:audioFile"))
            if media is not None:
                if media.get(R_LINK):
                    video_rids.append(media.get(R_LINK))
                for m in nvpr.iter(q("p14:media")):
                    if m.get(R_EMBED):
                        video_rids.append(m.get(R_EMBED))
        if video_rids:
            blob = None
            external = False
            for rid in video_rids:
                blob, external, _ = _rel_blob(slide.part, rid)
                if blob:
                    break
            k = len(videos) + 1
            vunit = Unit(kind="cine_clip", source_id=sid, locator=f"slide {n} video {k}")
            if blob:
                vitem = ImageItem(
                    index=0,
                    data=blob,
                    sha256=sha256_bytes(blob),
                    info=ImageInfo(detected="video", format="video", mime=video_mime(blob[:64])),
                    origin="pptx_media",
                    video_mime=video_mime(blob[:64]),
                )
                vunit.video = vitem
                vunit.notes.append("embedded media clip; poster frame not extracted")
                vunit.missing.append(
                    "video clip is kept as original bytes but not packaged (sim-case-import@1 frames are image/DICOM only)"
                )
                vunit.findings.append(
                    Finding("medium", f"{loc} video {k}", "video frames not checked for burned-in text or faces", "pixel_text", "content")
                )
            else:
                vunit.missing.append("linked (not embedded) media clip: target withheld" if external else "media clip part missing")
            vunit.label = f"Deck {sid[:8]} slide {n}: media clip {k}"
            vunit.teaching_annotations = None
            videos.append(vunit)
            continue

        blip = el.find(".//" + q("a:blip"))
        if blip is None:
            continue
        rid = blip.get(R_EMBED)
        if not rid:
            if blip.get(R_LINK):
                unit.missing.append("linked (not embedded) picture: image not in the deck (link target withheld)")
            continue
        blob, external, partname = _rel_blob(slide.part, rid)
        extracted_rids.add(rid)
        if blob is None:
            unit.missing.append("picture relationship could not be resolved")
            continue
        if partname in by_part:
            item = by_part[partname]
        else:
            idx = len(images)
            item, _img = build_image_item(idx, blob, "pptx_media", f"{loc} image {idx + 1}", institutions)
            if rec.detail == "image-filled shape":
                item.notes.append("image used as a shape fill")
            if not item.info.decodable or not (item.info.browser_displayable or item.info.convertible):
                unit.missing.append(f"image {idx + 1}: {item.info.error or 'cannot be converted losslessly'}")
            by_part[partname] = item
            images.append(item)
        pic_items.append((rec, item))
        img_loc = f"{loc} image {item.index + 1}"

        src_rect = el.find(".//" + q("a:srcRect"))
        if src_rect is not None:
            crops = {k: _int(src_rect.get(k)) / 1000.0 for k in ("l", "t", "r", "b")}
            if any(v > 1.0 for v in crops.values()):
                desc = ", ".join(f"{name} {crops[k]:.0f}%" for k, name in (("l", "left"), ("t", "top"), ("r", "right"), ("b", "bottom")) if crops[k] > 1.0)
                item.findings.append(
                    Finding(
                        "high",
                        img_loc,
                        f"picture is cropped on the slide ({desc}); PowerPoint crops are non-destructive, so the extracted original includes the cropped-out regions - review them for burned-in identifiers",
                        "crop",
                        "content",
                    )
                )
                item.fidelity_notes.append(f"slide shows a cropped view ({desc}); original uncropped image extracted")
        fh, fv, rot = _flips(el)
        if fh or fv or rot:
            what = ", ".join(x for x in ("flipped horizontally" if fh else "", "flipped vertically" if fv else "", f"rotated {rot / 60000:.0f} degrees" if rot else "") if x)
            item.fidelity_notes.append(f"slide displays this picture {what}; the original orientation is preserved - verify left/right")
        effects = sorted({etree.QName(c).localname for c in blip if isinstance(c.tag, str)} & BLIP_EFFECTS)
        if effects or blip.find(".//" + "{http://schemas.microsoft.com/office/drawing/2010/main}imgProps") is not None:
            item.fidelity_notes.append("slide applies display adjustments (brightness/contrast/recolour/effects); original pixels extracted without them")

    # Annotations and opaque overlays relative to pictures (z-order: later = on top).
    annotated = False
    for rec, item in pic_items:
        if rec.box is None or rec.box.area <= 0:
            continue
        img_loc = f"{loc} image {item.index + 1}"
        for ann in annotations:
            if ann.box is None or ann.z < rec.z:
                continue
            if not _overlaps(rec.box, ann.box):
                continue
            if ann.detail == "text label" and ann.box.area > 0 and rec.box.intersection(ann.box) / ann.box.area < 0.5:
                continue  # big text placeholder merely touching the picture
            annotated = True
            item.notes.append(f"teaching annotation over picture: {ann.detail} (separate slide shape; not in the extracted original)")
        for ov in overlays:
            if ov.box is None or ov.z < rec.z:
                continue
            inter = rec.box.intersection(ov.box)
            if inter >= 0.005 * rec.box.area:
                item.findings.append(
                    Finding(
                        "high",
                        img_loc,
                        f"{ov.detail} covers part of the picture (possible redaction box); the extracted original image does NOT include the overlay - review the covered region",
                        "overlay",
                        "content",
                    )
                )
    unit.teaching_annotations = annotated if pic_items else False
    for item in images:
        item.notes = sorted(set(item.notes), key=item.notes.index)
        unit.findings.extend(item.findings)
    unit.images = images

    all_blips = {b.get(R_EMBED) for b in sld.iter(q("a:blip")) if b.get(R_EMBED)}
    bg = sld.find(qp("p:cSld", "p:bg"))
    if bg is not None and bg.find(".//" + q("a:blip")) is not None:
        unit.notes.append("slide background image not extracted")
    leftover = len(all_blips - extracted_rids)
    if leftover:
        unit.notes.append(f"{leftover} other embedded image reference(s) (fallback content, fills, charts or background) not extracted")

    parts = [f"Deck {sid[:8]} slide {n}: {len(images)} image(s)"]
    if unit.teaching_annotations:
        parts.append("teaching annotations")
    if "hidden slide" in unit.notes:
        parts.append("hidden")
    unit.label = ", ".join(parts)
    if not images:
        unit.notes.append("no images on slide")
    return [unit, *videos]


def _overlaps(a: Box, b: Box) -> bool:
    """Inclusive overlap test (lines have zero-width or zero-height boxes)."""
    return a.x0 <= b.x1 and b.x0 <= a.x1 and a.y0 <= b.y1 and b.y0 <= a.y1
