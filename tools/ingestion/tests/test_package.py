"""Package: exact sim-case-import@1 shape (independent validator), privacy status rules, zip."""

import hashlib
import json
import re
import zipfile

import pytest

from conftest import dicom_row, find_row
from ingest.cli import main as cli_main

SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")


# --------------------------------------------------------------------------- validator
def check_keys(obj, keys, where):
    assert isinstance(obj, dict), where
    assert set(obj) == set(keys), f"{where}: {sorted(set(obj) ^ set(keys))}"


def validate_package(pkg, pkg_dir):
    """Small, independent validator for the documented sim-case-import@1 format."""
    check_keys(pkg, ["format", "caseId", "caseFamilyId", "internalTitle", "sourceDiagnosis", "diagnosticBasis",
                     "truthStatus", "sourceReferences", "assets", "teachingText", "privacyFindings", "privacyStatus",
                     "notes"], "package")
    assert pkg["format"] == "sim-case-import@1"
    assert SLUG.match(pkg["caseId"]) and SLUG.match(pkg["caseFamilyId"])
    assert isinstance(pkg["internalTitle"], str) and pkg["internalTitle"].strip()
    for key in ("sourceDiagnosis", "diagnosticBasis", "teachingText"):
        assert pkg[key] is None or isinstance(pkg[key], str)
    assert pkg["truthStatus"] in ("confirmed", "probable", "differential_only", None)
    assert pkg["privacyStatus"] in ("quarantine", "checked")
    assert isinstance(pkg["notes"], str)
    refs = {}
    for ref in pkg["sourceReferences"]:
        check_keys(ref, ["id", "kind", "sourceFileId", "locator", "description"], "sourceReference")
        assert SLUG.match(ref["id"]) and ref["id"] not in refs
        assert ref["kind"] in ("pptx_slide", "image_file", "pdf_page", "dicom_series", "cine_clip")
        assert re.fullmatch(r"[a-f0-9]{16}", ref["sourceFileId"])
        assert ref["locator"] and ref["description"].strip()
        refs[ref["id"]] = ref
    assert refs and pkg["assets"]
    ids = set()
    for asset in pkg["assets"]:
        check_keys(asset, ["id", "kind", "modality", "neutralLabel", "sequence", "plane", "contrast", "frames",
                           "derivation", "dicom"], "asset")
        assert SLUG.match(asset["id"]) and asset["id"] not in ids
        ids.add(asset["id"])
        assert asset["kind"] in ("still", "stack", "cine", "dicom_stack")
        assert asset["modality"] in ("CT", "CTA", "CTP", "MR", "MRA", "MRV", "DSA", "US", "XR", "NM", "PET", "other")
        assert asset["neutralLabel"].strip()
        frames = asset["frames"]
        if asset["kind"] == "still":
            assert len(frames) == 1
        if asset["kind"] in ("stack", "cine"):
            assert len(frames) > 1
        for i, fr in enumerate(frames):
            check_keys(fr, ["index", "file", "mimeType", "width", "height", "sha256", "byteSize"], "frame")
            assert fr["index"] == i
            assert fr["mimeType"] in ("image/png", "image/jpeg", "image/webp", "application/dicom")
            assert fr["file"].startswith(f"frames/{asset['id']}/") and ".." not in fr["file"]
            assert all(isinstance(fr[k], int) and not isinstance(fr[k], bool) and fr[k] > 0 for k in ("width", "height", "byteSize"))
            assert HEX64.match(fr["sha256"])
            data = (pkg_dir / fr["file"]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == fr["sha256"] and len(data) == fr["byteSize"]
        der = asset["derivation"]
        check_keys(der, ["sourceReferenceId", "method", "notes", "preservesDiagnosticContent", "burnedInAnnotationsPresent"], "derivation")
        assert der["sourceReferenceId"] in refs
        assert der["method"] in ("original_embedded", "format_converted", "dicom_export")
        assert isinstance(der["notes"], str)
        assert isinstance(der["preservesDiagnosticContent"], bool) and isinstance(der["burnedInAnnotationsPresent"], bool)
        if asset["kind"] == "dicom_stack":
            d = asset["dicom"]
            check_keys(d, ["transferSyntaxUid", "photometricInterpretation", "rows", "columns", "bitsAllocated",
                           "rescaleSlope", "rescaleIntercept", "pixelSpacing", "sliceThickness",
                           "imageOrientationPatient", "sortedBy", "geometryValidated", "windowPresets"], "dicom")
            assert d["photometricInterpretation"] in ("MONOCHROME1", "MONOCHROME2", "RGB")
            assert d["sortedBy"] in ("image_position_patient", "instance_number")
            assert isinstance(d["geometryValidated"], bool)
            assert d["pixelSpacing"] is None or (len(d["pixelSpacing"]) == 2)
            assert d["imageOrientationPatient"] is None or len(d["imageOrientationPatient"]) == 6
            for w in d["windowPresets"]:
                check_keys(w, ["label", "center", "width"], "windowPreset")
            assert all(f["mimeType"] == "application/dicom" for f in frames)
        else:
            assert asset["dicom"] is None
    for f in pkg["privacyFindings"]:
        check_keys(f, ["severity", "location", "finding"], "privacyFinding")
        assert f["severity"] in ("high", "medium", "low")
    has_high = any(f["severity"] == "high" for f in pkg["privacyFindings"])
    expected = "checked" if (not has_high and pkg["teachingText"] is None) else "quarantine"
    assert pkg["privacyStatus"] == expected
    assert "approved" not in json.dumps(pkg["privacyStatus"])


# --------------------------------------------------------------------------- helpers
def build(pipeline, tmp_path, family, name, *extra, inventory=None):
    out = tmp_path / name
    args = ["-q", "package", "--family", family, "--inventory", str(inventory or pipeline.out / "inventory.json"),
            "--derivatives", str(pipeline.deriv / "derivatives.json"), "--out", str(out), *extra]
    assert cli_main(args) == 0
    pkg = json.loads((out / "case-import.json").read_text())
    validate_package(pkg, out)
    return pkg, out


def family_of(pipeline, key, locator):
    return find_row(pipeline.inventory, pipeline.corpus.sid(key), locator)["suggestedCaseFamilyId"]


# --------------------------------------------------------------------------- tests
def test_image_family_package(pipeline, tmp_path):
    fam = family_of(pipeline, "deck_a", "slide 1")
    pkg, out = build(pipeline, tmp_path, fam, "pkg-images", "--diagnosis", "Cerebral abscess",
                     "--basis", "Aspiration culture", "--truth-status", "confirmed")
    assert pkg["caseFamilyId"] == fam
    assert pkg["truthStatus"] == "confirmed" and pkg["sourceDiagnosis"] == "Cerebral abscess"
    assert len(pkg["assets"]) == 3 and all(a["kind"] == "still" for a in pkg["assets"])
    assert pkg["assets"][0]["frames"][0]["sha256"] == hashlib.sha256(pipeline.corpus.media["img_a"]).hexdigest()
    assert pkg["assets"][0]["neutralLabel"] == "Image 1 (to be labelled by owner)"
    assert {r["sourceFileId"] for r in pkg["sourceReferences"]} == {pipeline.corpus.sid("deck_a"), pipeline.corpus.sid("deck_b")}
    assert pkg["teachingText"] is None
    # identifiers in slide text are reported, but the text itself is excluded -> not high
    loc = [f for f in pkg["privacyFindings"] if f["location"].startswith("src-1 slide 1 text")]
    assert loc and all(f["severity"] == "medium" and "NOT included" in f["finding"] for f in loc)
    assert any("pixel text not checked" in f["finding"] for f in pkg["privacyFindings"])
    assert pkg["privacyStatus"] == "checked"
    zip_path = out.with_name(out.name + ".zip")
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        assert names[0] == "case-import.json" and "frames/a1/0.png" in names
        assert json.loads(zf.read("case-import.json")) == pkg


def test_dicom_family_package(pipeline, tmp_path):
    fam = dicom_row(pipeline.inventory, "MR")["suggestedCaseFamilyId"]
    pkg, _out = build(pipeline, tmp_path, fam, "pkg-dicom", "--include-rendered-png")
    kinds = [a["kind"] for a in pkg["assets"]]
    assert kinds == ["dicom_stack", "stack"]
    stack = pkg["assets"][0]
    assert stack["modality"] == "MR" and len(stack["frames"]) == 4
    assert stack["dicom"]["sortedBy"] == "image_position_patient" and stack["dicom"]["geometryValidated"] is True
    assert stack["derivation"]["method"] == "dicom_export"
    assert pkg["assets"][1]["derivation"]["preservesDiagnosticContent"] is False
    assert "Rendered derivative" in pkg["assets"][1]["derivation"]["notes"]
    assert any("recognizable features risk" in f["finding"] for f in pkg["privacyFindings"])
    assert pkg["sourceReferences"][0]["kind"] == "dicom_series"


def test_high_finding_keeps_package_in_quarantine(pipeline, tmp_path):
    fam = family_of(pipeline, "deck_a", "slide 4")  # opaque box over the picture
    pkg, _ = build(pipeline, tmp_path, fam, "pkg-overlay")
    assert any(f["severity"] == "high" and "redaction" in f["finding"] for f in pkg["privacyFindings"])
    assert pkg["privacyStatus"] == "quarantine"
    assert pkg["assets"][0]["derivation"]["method"] == "format_converted"


def test_include_source_text_forces_quarantine(pipeline, tmp_path):
    inv_dir = tmp_path / "inv-text"
    assert cli_main(["-q", "inventory", str(pipeline.corpus.src), "--out", str(inv_dir), "--include-source-text"]) == 0
    fam = family_of(pipeline, "deck_a", "slide 1")
    pkg, _ = build(pipeline, tmp_path, fam, "pkg-text", "--include-source-text", inventory=inv_dir / "inventory.json")
    assert pkg["privacyStatus"] == "quarantine"
    assert "Test Person" in pkg["teachingText"]


def test_unknown_family_and_bad_slug_rejected(pipeline, tmp_path):
    base = ["-q", "package", "--inventory", str(pipeline.out / "inventory.json"),
            "--derivatives", str(pipeline.deriv / "derivatives.json")]
    assert cli_main([*base, "--family", "fam-000000000000", "--out", str(tmp_path / "p1")]) == 1
    assert cli_main([*base, "--family", "Not A Slug", "--out", str(tmp_path / "p2")]) == 1
    fam = family_of(pipeline, "deck_a", "slide 1")
    assert cli_main([*base, "--family", fam, "--case-id", "Bad Case!", "--out", str(tmp_path / "p3")]) == 1


def test_identifier_in_owner_title_is_flagged(pipeline, tmp_path):
    fam = family_of(pipeline, "deck_a", "slide 1")
    pkg, _ = build(pipeline, tmp_path, fam, "pkg-title", "--title", "Abscess case, MRN 12345678", "--case-id", "abscess-01")
    assert pkg["caseId"] == "abscess-01"
    assert any(f["location"] == "internalTitle" and f["severity"] == "high" for f in pkg["privacyFindings"])
    assert pkg["privacyStatus"] == "quarantine"


def test_rebuild_requires_force(pipeline, tmp_path):
    fam = family_of(pipeline, "deck_a", "slide 1")
    _pkg, out = build(pipeline, tmp_path, fam, "pkg-force")
    base = ["-q", "package", "--family", fam, "--inventory", str(pipeline.out / "inventory.json"),
            "--derivatives", str(pipeline.deriv / "derivatives.json"), "--out", str(out)]
    assert cli_main(base) == 1
    assert cli_main([*base, "--force"]) == 0


@pytest.mark.parametrize("key,locator", [("gif", "clip 1"), ("pdf", "page 2")])
def test_other_asset_kinds(pipeline, tmp_path, key, locator):
    fam = family_of(pipeline, key, locator)
    pkg, _ = build(pipeline, tmp_path, fam, f"pkg-{key}")
    if key == "gif":
        assert pkg["assets"][0]["kind"] == "cine" and len(pkg["assets"][0]["frames"]) == 3
    else:
        assert pkg["assets"][0]["derivation"]["method"] == "format_converted"
        assert pkg["privacyStatus"] == "quarantine"  # redaction-box finding


def test_tampered_derivative_fails_atomically(pipeline, tmp_path):
    import shutil

    deriv = tmp_path / "deriv-copy"
    shutil.copytree(pipeline.deriv, deriv)
    fam = family_of(pipeline, "deck_a", "slide 1")
    doc = json.loads((deriv / "derivatives.json").read_text())
    sid = pipeline.corpus.sid("deck_a")
    target = next(d for d in doc["derivatives"] if d["sourceFileId"] == sid and d["locator"] == "slide 1")
    (deriv / target["file"]).write_bytes(b"tampered")
    out = tmp_path / "pkg-tampered"
    assert cli_main(["-q", "package", "--family", fam, "--inventory", str(pipeline.out / "inventory.json"),
                     "--derivatives", str(deriv / "derivatives.json"), "--out", str(out)]) == 1
    assert not out.exists() and not out.with_name(out.name + ".zip").exists()
    assert not [p for p in tmp_path.iterdir() if ".staging-" in p.name]
