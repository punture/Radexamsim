"""Extract: original embedded bytes (same SHA-256), lossless conversion, honest rejections."""

import hashlib
import io
import json
import stat

import numpy as np
import pytest
from PIL import Image

from ingest.cli import main as cli_main

REQUIRED = ("sourceFileId", "locator", "method", "sha256", "mimeType", "width", "height", "byteSize", "notes")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def derivs(pipeline, key, locator):
    sid = pipeline.corpus.sid(key)
    return [d for d in pipeline.derivatives["derivatives"] if d["sourceFileId"] == sid and d["locator"] == locator]


def group(pipeline, key, locator, variant=None):
    sid = pipeline.corpus.sid(key)
    gs = [g for g in pipeline.derivatives["groups"] if g["sourceFileId"] == sid and g["locator"] == locator]
    if variant:
        gs = [g for g in gs if g["variant"] == variant]
    assert len(gs) == 1, gs
    return gs[0]


def test_derivative_records_have_required_fields(pipeline):
    doc = pipeline.derivatives
    assert doc["format"] == "sim-ingest-derivatives@1"
    assert doc["derivatives"]
    for d in doc["derivatives"]:
        for key in REQUIRED:
            assert key in d, key
        assert d["method"] in ("original_embedded", "format_converted", "dicom_export")
        data = (pipeline.deriv / d["file"]).read_bytes()
        assert sha(data) == d["sha256"] and len(data) == d["byteSize"]
        assert stat.S_IMODE((pipeline.deriv / d["file"]).stat().st_mode) == 0o600


def test_pptx_embedded_original_bytes_unchanged(pipeline):
    media = pipeline.corpus.media
    (a1,) = derivs(pipeline, "deck_a", "slide 1")
    assert a1["method"] == "original_embedded" and a1["mimeType"] == "image/png"
    assert a1["sha256"] == sha(media["img_a"])  # exact bytes of ppt/media, no recompression
    assert (a1["width"], a1["height"]) == (256, 256)
    (b1,) = derivs(pipeline, "deck_b", "slide 1")
    assert b1["sha256"] == sha(media["img_a"])
    (b2,) = derivs(pipeline, "deck_b", "slide 2")
    assert b2["sha256"] == sha(media["img_a_jpeg"]) and b2["mimeType"] == "image/jpeg"
    (a2,) = derivs(pipeline, "deck_a", "slide 2")
    assert a2["sha256"] == sha(media["img_b"])  # the cropped picture is extracted uncropped


def test_pdf_embedded_jpeg_stream_unchanged_and_flate_lossless(pipeline):
    media = pipeline.corpus.media
    (p1,) = derivs(pipeline, "pdf", "page 1")
    assert p1["method"] == "original_embedded" and p1["mimeType"] == "image/jpeg"
    assert p1["sha256"] == sha(media["pdf_jpeg"])
    (p2,) = derivs(pipeline, "pdf", "page 2")
    assert p2["method"] == "format_converted" and p2["mimeType"] == "image/png"
    img = Image.open(pipeline.deriv / p2["file"])
    assert img.size == (120, 120)
    assert img.tobytes() == media["pdf_flate_raw"]  # decoded samples preserved exactly


def test_tiff_converted_losslessly(pipeline):
    media = pipeline.corpus.media
    (t,) = derivs(pipeline, "tiff", "image 1")
    assert t["method"] == "format_converted" and t["mimeType"] == "image/png"
    original = np.asarray(Image.open(io.BytesIO(media["tif16"])))
    converted = np.asarray(Image.open(pipeline.deriv / t["file"]))
    assert original.shape == converted.shape == (96, 96)
    assert np.array_equal(original.astype(np.uint32), converted.astype(np.uint32))  # 16-bit values preserved
    assert t["originalSha256"] == sha(media["tif16"])
    (c,) = derivs(pipeline, "deck_a", "slide 4")  # TIFF inside a PPTX
    assert c["method"] == "format_converted"
    assert np.array_equal(np.asarray(Image.open(io.BytesIO(media["tif_c"]))), np.asarray(Image.open(pipeline.deriv / c["file"])))


def test_animated_gif_becomes_cine_frames(pipeline):
    g = group(pipeline, "gif", "clip 1")
    assert g["assetKind"] == "cine" and len(g["derivativeIds"]) == 3


def test_emf_and_compressed_dicom_reported_not_faked(pipeline):
    rejected = pipeline.derivatives["rejected"]
    emf_sid = pipeline.corpus.sid("emf")
    assert any(r["sourceFileId"] == emf_sid and "cannot be rasterised" in r["reason"] for r in rejected)
    assert not derivs(pipeline, "emf", "image 1")
    msgs = [r["reason"] for r in rejected if "transfer syntax" in r["reason"]]
    assert msgs and "Unsupported transfer syntax 1.2.840.10008.1.2.4.50" in msgs[0]
    assert "1.2.840.10008.1.2.1" in msgs[0]  # lists what IS supported


def test_video_kept_original_but_marked(pipeline):
    g = group(pipeline, "video", "clip 1")
    assert g["variant"] == "video" and "Not packaged" in g["notes"]


def test_findings_carried_to_derivatives(pipeline):
    s2 = group(pipeline, "deck_a", "slide 2")
    assert any(f["severity"] == "high" and "cropped" in f["finding"] for f in s2["findings"])
    phone = group(pipeline, "phone", "image 1")
    assert any(f["severity"] == "high" and "GPS" in f["finding"] for f in phone["findings"])
    assert any("pixel text not checked" in f["finding"] for f in phone["findings"])  # no OCR


def test_strip_metadata_option(pipeline, tmp_path):
    out = tmp_path / "deriv-strip"
    assert cli_main(["-q", "extract", str(pipeline.qdir), "--out", str(out), "--strip-metadata", "--no-ocr"]) == 0
    doc = json.loads((out / "derivatives.json").read_text())
    sid = pipeline.corpus.sid("phone")
    (d,) = [x for x in doc["derivatives"] if x["sourceFileId"] == sid]
    data = (out / d["file"]).read_bytes()
    assert d["method"] == "original_embedded" and d["originalSha256"] == sha(pipeline.corpus.media["phone_jpeg"])
    assert d["sha256"] != d["originalSha256"]
    img = Image.open(io.BytesIO(data))
    assert not img.getexif()
    original = Image.open(io.BytesIO(pipeline.corpus.media["phone_jpeg"]))
    assert np.array_equal(np.asarray(img), np.asarray(original))  # pixels untouched
    (g,) = [x for x in doc["groups"] if x["sourceFileId"] == sid]
    assert not any("GPS" in f["finding"] for f in g["findings"])


def test_extract_refuses_existing_output_and_non_quarantine(pipeline, tmp_path):
    assert cli_main(["-q", "extract", str(pipeline.qdir), "--out", str(pipeline.deriv), "--no-ocr"]) == 1
    assert cli_main(["-q", "extract", str(pipeline.corpus.src), "--out", str(tmp_path / "x"), "--no-ocr"]) == 1


@pytest.mark.parametrize("fake_text,expected", [("Name: Test Person 12345678", "high"), ("", "low")])
def test_ocr_path_with_fake_tesseract(tmp_path, monkeypatch, fake_text, expected):
    """OCR is optional; when tesseract exists its text is pattern-checked (never stored)."""
    from ingest import ocr

    script = tmp_path / "bin" / "tesseract"
    script.parent.mkdir()
    script.write_text(f"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'tesseract 9.9'; exit 0; fi\nprintf '%s' '{fake_text}'\n")
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{script.parent}:/usr/bin:/bin")
    assert ocr.ocr_status()["available"] is True
    text = ocr.run_ocr(b"\x89PNG fake", ".png")
    findings = ocr.ocr_findings(text, "slide 1 image 1")
    assert findings[0].severity == expected
    assert all("Test Person" not in f.finding for f in findings)
