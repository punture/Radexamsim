"""Focused checks: PPTX groups/flips/connectors, PDF inline images, family merging, DICOM grouping."""

import hashlib
import io
import json

from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.util import Inches

from conftest import UID_ROOT, _pdf, _stream, brain_image, find_row, mr_slice, png_bytes
from ingest.cli import main as cli_main
from ingest.dicom_series import build_series_units, make_instance
from ingest.families import compute_families
from ingest.model import SourceFile
from ingest.pdf_reader import analyze_pdf
from ingest.pptx_reader import analyze_pptx


def source(data: bytes, kind: str) -> SourceFile:
    return SourceFile(path=None, rel=f"x.{kind}", sha256=hashlib.sha256(data).hexdigest(), size=len(data), detected=kind)


def test_grouped_picture_flip_and_connector_arrow():
    img = png_bytes(brain_image(31))
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[6])
    grp = s1.shapes.add_group_shape()
    grp.shapes.add_picture(io.BytesIO(img), Inches(1), Inches(1), Inches(3), Inches(3))
    grp.shapes.add_shape(MSO_SHAPE.OVAL, Inches(2), Inches(2), Inches(0.5), Inches(0.5)).fill.background()
    s2 = prs.slides.add_slide(prs.slide_layouts[6])
    pic = s2.shapes.add_picture(io.BytesIO(img), Inches(1), Inches(1), Inches(3), Inches(3))
    pic._element.find(qn("p:spPr")).find(qn("a:xfrm")).set("flipH", "1")
    line = s2.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(0.5), Inches(2), Inches(2), Inches(2))  # zero height
    ln = line._element.find(qn("p:spPr")).get_or_add_ln()
    ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))
    buf = io.BytesIO()
    prs.save(buf)
    data = buf.getvalue()
    res = analyze_pptx(source(data, "pptx"), data)
    u1, u2 = res.units
    assert u1.teaching_annotations is True  # outline circle inside a group, over a grouped picture
    assert u1.images[0].sha256 == hashlib.sha256(img).hexdigest()
    assert u2.teaching_annotations is True  # arrow connector (zero-height box) over the picture
    assert any("arrow" in n for n in u2.images[0].notes)
    assert any("flipped horizontally" in n for n in u2.images[0].fidelity_notes)
    assert not any(f.severity == "high" for f in u1.findings + u2.findings)


def test_pdf_inline_image_extracted_losslessly():
    pixels = bytes((i * 4) % 256 for i in range(64))
    content = b"q 100 0 0 100 50 50 cm\nBI /W 8 /H 8 /CS /G /BPC 8 ID\n" + pixels + b"\nEI\nQ\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>",
        _stream("", content),
        b"<< /Author (x) >>",
    ]
    data = _pdf(objects, 5)
    res = analyze_pdf(source(data, "pdf"), data)
    (unit,) = res.units
    (item,) = unit.images
    assert item.origin == "pdf_decoded"
    assert Image.open(io.BytesIO(item.data)).tobytes() == pixels


def test_placeholder_patient_ids_do_not_merge_cases():
    units_in = []
    for n in range(2):
        uids = {"study": UID_ROOT + f"70{n}", "series": UID_ROOT + f"71{n}", "for": UID_ROOT + f"72{n}"}
        ds = mr_slice(0, 0.0, 1, UID_ROOT + f"73{n}", UID_ROOT + f"73{n}", uids)
        ds.PatientID = "ANONYMOUS"
        units_in.append(make_instance(SourceFile(path=None, rel=f"s{n}.dcm", sha256=f"{n}" * 64, size=0, detected="dicom"), ds))
    units = build_series_units(units_in)
    assert len(units) == 2
    row_family, _fams, _notes = compute_families(units)
    assert len(set(row_family.values())) == 2
    same = []
    for n in range(2):
        uids = {"study": UID_ROOT + f"80{n}", "series": UID_ROOT + f"81{n}", "for": UID_ROOT + f"82{n}"}
        ds = mr_slice(0, 0.0, 1, UID_ROOT + f"83{n}", UID_ROOT + f"83{n}", uids)
        same.append(make_instance(SourceFile(path=None, rel=f"t{n}.dcm", sha256=f"{n + 2}" * 64, size=0, detected="dicom"), ds))
    row_family, _fams, _notes = compute_families(build_series_units(same))
    assert len(set(row_family.values())) == 1  # real (non-placeholder) PatientID links prior/follow-up studies


def test_merging_two_families_into_one_case(pipeline, tmp_path):
    inv = pipeline.inventory
    fam1 = find_row(inv, pipeline.corpus.sid("deck_a"), "slide 1")["suggestedCaseFamilyId"]
    fam2 = find_row(inv, pipeline.corpus.sid("tiff"), "image 1")["suggestedCaseFamilyId"]
    out = tmp_path / "merged"
    assert cli_main(["-q", "package", "--family", fam1, "--family", fam2, "--inventory", str(pipeline.out / "inventory.json"),
                     "--derivatives", str(pipeline.deriv / "derivatives.json"), "--out", str(out)]) == 0
    pkg = json.loads((out / "case-import.json").read_text())
    assert pkg["caseFamilyId"] == fam1 and len(pkg["assets"]) == 4
    assert fam2 in pkg["notes"]


def test_unexpected_errors_do_not_print_paths(tmp_path, capsys):
    secret_dir = tmp_path / "Patient_Secretname_files"
    secret_dir.mkdir()
    (secret_dir / "x.pptx").write_bytes(b"PK\x03\x04 not really a zip")
    assert cli_main(["inventory", str(secret_dir), "--out", str(tmp_path / "o")]) == 0
    captured = capsys.readouterr()
    assert "Secretname" not in captured.out + captured.err
    inv = json.loads((tmp_path / "o" / "inventory.json").read_text())
    assert inv["unsupportedSources"] and "Secretname" not in json.dumps(inv)


def test_extract_with_fake_ocr_flags_pixel_text(pipeline, tmp_path, monkeypatch):
    """With tesseract present, OCR text is pattern-checked and marks burned-in annotations."""
    script = tmp_path / "bin" / "tesseract"
    script.parent.mkdir()
    script.write_text("#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'tesseract 9.9'; exit 0; fi\nprintf 'Name: Test Person'\n")
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{script.parent}:/usr/bin:/bin")
    out = tmp_path / "deriv-ocr"
    assert cli_main(["-q", "extract", str(pipeline.qdir), "--out", str(out)]) == 0
    doc = json.loads((out / "derivatives.json").read_text())
    assert doc["ocr"]["available"] is True
    sid = pipeline.corpus.sid("deck_a")
    g = next(x for x in doc["groups"] if x["sourceFileId"] == sid and x["locator"] == "slide 1")
    assert g["burnedInAnnotationsPresent"] is True
    assert any(f["category"] == "ocr" and f["severity"] == "high" for f in g["findings"])
    assert "Test Person" not in (out / "derivatives.json").read_text()
    dicom = next(x for x in doc["groups"] if x["variant"] == "dicom")
    assert any(f["category"] == "ocr" for f in dicom["findings"])  # rendered in memory for OCR


def test_png_metadata_strip_is_lossless():
    from PIL.PngImagePlugin import PngInfo

    from ingest.images import strip_png_metadata

    info = PngInfo()
    info.add_text("Comment", "Patient Name: Jane Roe")
    buf = io.BytesIO()
    brain_image(40, 64).save(buf, format="PNG", pnginfo=info)
    data = buf.getvalue()
    stripped = strip_png_metadata(data)
    assert stripped is not None and b"Jane Roe" not in stripped
    assert Image.open(io.BytesIO(stripped)).tobytes() == Image.open(io.BytesIO(data)).tobytes()


def test_render_monochrome1_rgb_and_multiframe_sorting():
    import numpy as np
    from pydicom.uid import SecondaryCaptureImageStorage

    from ingest.dicom_series import render_frames, sort_instances

    ds = mr_slice(0, 0.0, 1, UID_ROOT + "901", UID_ROOT + "901", {"study": UID_ROOT + "902", "series": UID_ROOT + "903", "for": UID_ROOT + "904"})
    ds.PhotometricInterpretation = "MONOCHROME1"
    (png, w, h), = render_frames(ds, 300.0, 600.0)
    assert np.asarray(Image.open(io.BytesIO(png)))[0, 0] == 255  # inverted: stored 0 renders white
    rgb = mr_slice(1, 0.0, 1, UID_ROOT + "905", UID_ROOT + "905", {"study": UID_ROOT + "902", "series": UID_ROOT + "906", "for": UID_ROOT + "904"})
    rgb.SOPClassUID = SecondaryCaptureImageStorage
    rgb.PhotometricInterpretation, rgb.SamplesPerPixel, rgb.PlanarConfiguration = "RGB", 3, 0
    rgb.BitsAllocated, rgb.BitsStored, rgb.HighBit = 8, 8, 7
    rgb.PixelData = np.full((64, 64, 3), (10, 20, 30), dtype=np.uint8).tobytes()
    (png, w, h), = render_frames(rgb, None, None)
    assert Image.open(io.BytesIO(png)).getpixel((5, 5)) == (10, 20, 30)
    multi = mr_slice(2, 0.0, 1, UID_ROOT + "907", UID_ROOT + "907", {"study": UID_ROOT + "902", "series": UID_ROOT + "908", "for": UID_ROOT + "904"})
    multi.NumberOfFrames = 2
    multi.PixelData = multi.PixelData * 2
    inst = make_instance(SourceFile(path=None, rel="m.dcm", sha256="9" * 64, size=0, detected="dicom"), multi)
    _ordered, sorted_by, validated, notes = sort_instances([inst])
    assert (sorted_by, validated) == ("instance_number", False) and any("multi-frame" in n for n in notes)
    assert len(render_frames(multi, 300.0, 600.0)) == 2


def test_series_export_is_all_or_nothing(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    uids = {"study": UID_ROOT + "9501", "series": UID_ROOT + "9502", "for": UID_ROOT + "9503"}
    for k in range(2):
        ds = mr_slice(k, 5.0 * k, k + 1, UID_ROOT + f"951{k}", UID_ROOT + "9510", uids)
        if k == 1:
            ds.PixelData = ds.PixelData[:100]  # truncated pixel data in the second instance
        ds.save_as(str(src / f"s{k}.dcm"), enforce_file_format=True)
    qdir, out = tmp_path / "q", tmp_path / "d"
    assert cli_main(["-q", "quarantine", str(src), "--quarantine", str(qdir)]) == 0
    assert cli_main(["-q", "extract", str(qdir), "--out", str(out), "--no-ocr"]) == 0
    doc = json.loads((out / "derivatives.json").read_text())
    assert not doc["groups"] and not doc["derivatives"]
    assert any("PixelData is shorter" in r["reason"] for r in doc["rejected"])
    assert not list((out / "files").rglob("*.dcm")) if (out / "files").exists() else True


def test_corner_text_heuristic_flags_overlay_text_only():
    from PIL import ImageDraw, ImageFont

    from ingest.images import build_image_item

    img = brain_image(3, 512)
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=13)
    draw.text((4, 4), "DOE^JANE  MRN 12345678", fill=255, font=font)
    draw.text((4, 22), "2024-01-15  CT HEAD", fill=255, font=font)
    flagged, _ = build_image_item(0, png_bytes(img), "file", "image 1")
    clean, _ = build_image_item(0, png_bytes(brain_image(3, 512)), "file", "image 1")
    assert any(f.category == "pixel_text" and f.severity == "medium" for f in flagged.findings)
    assert not any(f.category == "pixel_text" for f in clean.findings)


def test_exif_free_text_decoded_and_checked():
    from ingest.images import build_image_item

    from conftest import jpeg_bytes

    exif = Image.Exif()
    exif[0x9C9C] = "Name: Jane Roe".encode("utf-16-le")  # XPComment (UTF-16LE)
    exif.get_ifd(0x8769)[0x9286] = b"ASCII\x00\x00\x00MRN 12345678"  # UserComment, even length
    item, _ = build_image_item(0, jpeg_bytes(brain_image(41, 96).convert("RGB"), exif=exif), "file", "image 1")
    found = {f.finding for f in item.findings if f.severity == "high"}
    assert any("name label" in f and "XPComment" in f for f in found)
    assert any("MRN" in f and "UserComment" in f for f in found)
    assert all("Jane" not in f.finding and "12345678" not in f.finding for f in item.findings)
