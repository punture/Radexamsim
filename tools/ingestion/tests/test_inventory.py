"""Inventory: rows, identifier findings, teaching annotations, families, rights, CSV."""

import csv
import io
import json

from conftest import dicom_row, find_row
from ingest.cli import main as cli_main


def findings_text(row):
    return [(f["severity"], f["location"], f["finding"]) for f in row["identifierFindings"]]


def test_inventory_rows_and_kinds(pipeline):
    inv = pipeline.inventory
    assert inv["format"] == "sim-ingest-inventory@1"
    assert inv["includesSourceText"] is False
    kinds = {r["kind"] for r in inv["rows"]}
    assert {"pptx_slide", "image_file", "pdf_page", "dicom_series", "cine_clip"} <= kinds
    deck_a = pipeline.corpus.sid("deck_a")
    for n in (1, 2, 3, 4):
        find_row(inv, deck_a, f"slide {n}")
    row = find_row(inv, deck_a, "slide 1")
    for key in (
        "sourceFileId", "kind", "locator", "label", "imageCount", "dimensions", "modalityHint", "qualityHints",
        "teachingAnnotations", "identifierFindings", "commercialUseStatus", "missingMaterial", "suggestedCaseFamilyId",
    ):
        assert key in row
    assert row["imageCount"] == 1
    assert row["dimensions"] == [{"width": 256, "height": 256}]
    assert row["qualityHints"]["minDimension"] == 256 and row["qualityHints"]["bits"] == 8
    assert row["modalityHint"] is None


def test_identifier_findings_flagged(pipeline):
    inv = pipeline.inventory
    row = find_row(inv, pipeline.corpus.sid("deck_a"), "slide 1")
    f = findings_text(row)
    assert ("high", "slide 1 text", "name label followed by a value (e.g. 'Name:') in text") in f
    assert ("high", "slide 1 text", "MRN / health-card / patient-ID label with a number in text") in f
    assert ("high", "slide 1 notes", "date-of-birth label with a date in notes") in f
    assert any(s == "medium" and "configured institution name" in t for s, _, t in f)
    pdf1 = find_row(inv, pipeline.corpus.sid("pdf"), "page 1")
    assert any(s == "high" and "accession-number label" in t for s, _, t in findings_text(pdf1))
    mr = dicom_row(inv, "MR")
    phi = [t for s, _, t in findings_text(mr) if s == "high" and "identifying DICOM attributes" in t]
    assert phi and "PatientName" in phi[0] and "InstitutionName" in phi[0]
    assert any("private attribute" in t for _, _, t in findings_text(mr))


def test_teaching_annotations_and_overlay_checks(pipeline):
    inv = pipeline.inventory
    deck_a = pipeline.corpus.sid("deck_a")
    assert find_row(inv, deck_a, "slide 1")["teachingAnnotations"] is True  # arrow over the picture
    assert find_row(inv, deck_a, "slide 2")["teachingAnnotations"] is False
    s2 = findings_text(find_row(inv, deck_a, "slide 2"))
    assert any(s == "high" and "cropped on the slide" in t for s, _, t in s2)
    s4 = findings_text(find_row(inv, deck_a, "slide 4"))
    assert any(s == "high" and "possible redaction box" in t for s, _, t in s4)
    pdf2 = find_row(inv, pipeline.corpus.sid("pdf"), "page 2")
    assert pdf2["teachingAnnotations"] is True
    assert any(s == "high" and "possible redaction box" in t for s, _, t in findings_text(pdf2))


def test_duplicate_images_share_one_family(pipeline):
    inv = pipeline.inventory
    a, b = pipeline.corpus.sid("deck_a"), pipeline.corpus.sid("deck_b")
    fam_a1 = find_row(inv, a, "slide 1")["suggestedCaseFamilyId"]
    assert fam_a1 and fam_a1.startswith("fam-")
    assert find_row(inv, b, "slide 1")["suggestedCaseFamilyId"] == fam_a1  # identical bytes, other deck
    assert find_row(inv, b, "slide 2")["suggestedCaseFamilyId"] == fam_a1  # resized JPEG (near-identical)
    assert find_row(inv, a, "slide 2")["suggestedCaseFamilyId"] != fam_a1  # different image
    assert find_row(inv, a, "slide 3")["suggestedCaseFamilyId"] is None  # no images
    fam = next(f for f in inv["families"] if f["caseFamilyId"] == fam_a1)
    assert len(fam["rowIds"]) == 3
    assert "identical image bytes" in fam["reasons"]
    assert "near-identical images (perceptual hash)" in fam["reasons"]


def test_family_union_is_transitive():
    from ingest.families import UnionFind

    uf = UnionFind(["a", "b", "c", "d"])
    uf.union("a", "b")
    uf.union("c", "b")
    groups = {frozenset(v) for v in uf.groups().values()}
    assert frozenset({"a", "b", "c"}) in groups and frozenset({"d"}) in groups


def test_logo_like_repeated_images_do_not_merge_families():
    from ingest.families import compute_families
    from ingest.model import ImageInfo, ImageItem, Unit

    logo = ImageInfo(detected="png", width=200, height=100, decodable=True, dhash="f0" * 32, ahash="0f" * 32)
    units = []
    for n in range(8):
        u = Unit(kind="pptx_slide", source_id="abcdef0123456789", locator=f"slide {n + 1}")
        u.images = [ImageItem(index=0, data=b"", sha256="1" * 64, info=logo, origin="pptx_media")]
        units.append(u)
    row_family, _families, notes = compute_families(units)
    assert len(set(row_family.values())) == 8
    assert all("ignored for family grouping" in notes[u.row_id][0] for u in units)


def test_rights_map_and_modality(pipeline):
    inv = pipeline.inventory
    assert find_row(inv, pipeline.corpus.sid("deck_a"), "slide 1")["commercialUseStatus"] == "cleared"
    assert find_row(inv, pipeline.corpus.sid("tiff"), "image 1")["commercialUseStatus"] == "restricted"
    assert find_row(inv, pipeline.corpus.sid("pdf"), "page 1")["commercialUseStatus"] == "unresolved"
    mr = dicom_row(inv, "MR")
    assert mr["modalityHint"] == "MR" and mr["imageCount"] == 4 and mr["locator"] == "series 2"
    assert mr["dicom"]["geometryValidated"] is True and mr["dicom"]["sortedBy"] == "image_position_patient"


def test_missing_material_reported(pipeline):
    inv = pipeline.inventory
    emf = find_row(inv, pipeline.corpus.sid("emf"), "image 1")
    assert any("EMF" in m and "not converted" in m for m in emf["missingMaterial"])
    jpeg_series = dicom_row(inv, "OT")
    assert any("Unsupported transfer syntax 1.2.840.10008.1.2.4.50" in m for m in jpeg_series["missingMaterial"])
    video = find_row(inv, pipeline.corpus.sid("video"), "clip 1")
    assert video["kind"] == "cine_clip" and any("not packaged" in m for m in video["missingMaterial"])
    gif = find_row(inv, pipeline.corpus.sid("gif"), "clip 1")
    assert gif["kind"] == "cine_clip" and gif["images"][0]["frames"] == 3


def test_inventory_csv(pipeline):
    text = (pipeline.out / "inventory.csv").read_text()
    rows = list(csv.DictReader(io.StringIO(text)))
    assert len(rows) == len(pipeline.inventory["rows"])
    assert {"sourceFileId", "kind", "locator", "label", "identifierFindings", "suggestedCaseFamilyId"} <= set(rows[0])


def test_no_raw_text_unless_requested(pipeline, tmp_path):
    blob = (pipeline.out / "inventory.json").read_text()
    for secret in ("Test Person", "12345678", "1970-01-02", "AB123456", "Jane Roe", "Doe^Jane", "MRN0012345"):
        assert secret not in blob
    out2 = tmp_path / "inv-text"
    assert cli_main(["-q", "inventory", str(pipeline.corpus.src), "--out", str(out2), "--include-source-text"]) == 0
    inv2 = json.loads((out2 / "inventory.json").read_text())
    assert inv2["includesSourceText"] is True
    row = find_row(inv2, pipeline.corpus.sid("deck_a"), "slide 1")
    assert "Test Person" in row["sourceText"]


def test_inventory_runs_on_quarantine_with_same_ids(pipeline, tmp_path):
    out = tmp_path / "inv-q"
    assert cli_main(["-q", "inventory", str(pipeline.qdir), "--out", str(out), "--rights-map", str(pipeline.corpus.files["rights"])]) == 0
    inv_q = json.loads((out / "inventory.json").read_text())
    ids = lambda inv: sorted((r["sourceFileId"], r["locator"], r["suggestedCaseFamilyId"]) for r in inv["rows"])  # noqa: E731
    assert ids(inv_q) == ids(pipeline.inventory)
    assert find_row(inv_q, pipeline.corpus.sid("deck_a"), "slide 1")["commercialUseStatus"] == "cleared"
