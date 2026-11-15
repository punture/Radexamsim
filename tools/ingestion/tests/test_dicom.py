"""DICOM de-identification (PS3.15 Annex E subset), geometry sorting and display validation."""

import copy
import io
import json

import numpy as np
import pydicom
import pytest
from PIL import Image
from pydicom.dataset import Dataset
from pydicom.uid import JPEG2000Lossless

from conftest import UID_ROOT, dicom_row, mr_slice
from ingest.cli import main as cli_main
from ingest.dicom_deid import (
    UidMapper,
    UnsupportedDicomError,
    check_transfer_syntax,
    deidentify,
    scan_deidentified,
    validate_for_display,
)
from ingest.dicom_series import make_instance, sort_instances
from ingest.model import SourceFile

PHI_ABSENT = [
    "InstitutionName", "InstitutionAddress", "PerformingPhysicianName", "OperatorsName", "StationName",
    "DeviceSerialNumber", "OtherPatientIDs", "PatientAddress", "PatientAge", "StudyDescription", "ProtocolName",
    "SeriesDate", "AcquisitionDate",
]
PHI_BLANK = ["PatientName", "PatientID", "PatientBirthDate", "PatientSex", "ReferringPhysicianName", "AccessionNumber", "StudyID", "StudyDate"]


def series_outputs(pipeline):
    mr = dicom_row(pipeline.inventory, "MR")
    groups = [g for g in pipeline.derivatives["groups"] if g["sourceFileId"] == mr["sourceFileId"]]
    dcm = next(g for g in groups if g["variant"] == "dicom")
    by_id = {d["id"]: d for d in pipeline.derivatives["derivatives"]}
    files = [pipeline.deriv / by_id[i]["file"] for i in dcm["derivativeIds"]]
    return dcm, [pydicom.dcmread(f) for f in files], groups, by_id


def test_phi_removed_and_private_tags_gone(pipeline):
    _g, datasets, _groups, _ = series_outputs(pipeline)
    assert len(datasets) == 4
    for ds in datasets:
        for kw in PHI_ABSENT:
            assert kw not in ds, kw
        for kw in PHI_BLANK:
            assert str(ds.get(kw, "")) == "", kw
        assert not any(elem.tag.is_private for elem in ds.iterall())
        assert ds.PatientIdentityRemoved == "YES"
        assert ds.DeidentificationMethod and "PS3.15" in ds.DeidentificationMethod[0]
        assert ds.LongitudinalTemporalInformationModified == "REMOVED"
        assert "SourceApplicationEntityTitle" not in ds.file_meta
        assert ds.SeriesDescription == "AX T2"  # vocabulary-only descriptor kept
        # geometry and display attributes kept
        assert [float(v) for v in ds.PixelSpacing] == [0.9, 0.9]
        assert [float(v) for v in ds.ImageOrientationPatient] == [1, 0, 0, 0, 1, 0]
        assert float(ds.WindowCenter) == 300 and float(ds.RescaleSlope) == 1
        blob = ds.to_json()
        for secret in ("Doe^Jane", "MRN0012345", "Example General Hospital", "Smith^John", "secret-patient-hash", "ACC998877"):
            assert secret not in blob


def test_uids_replaced_consistently(pipeline):
    corpus = pipeline.corpus
    _g, datasets, _groups, _ = series_outputs(pipeline)
    originals = {corpus.dicom["uids"]["study"], corpus.dicom["uids"]["series"], corpus.dicom["uids"]["for"], *corpus.dicom["sops"]}
    studies = {ds.StudyInstanceUID for ds in datasets}
    series = {ds.SeriesInstanceUID for ds in datasets}
    frames_of_ref = {ds.FrameOfReferenceUID for ds in datasets}
    sops = [ds.SOPInstanceUID for ds in datasets]
    assert len(studies) == len(series) == len(frames_of_ref) == 1
    assert len(set(sops)) == 4
    for uid in [*studies, *series, *frames_of_ref, *sops]:
        assert uid not in originals and uid.startswith("2.25.") and len(uid) <= 64
    for ds in datasets:
        assert ds.file_meta.MediaStorageSOPInstanceUID == ds.SOPInstanceUID
    # the reference to slice 0 inside a sequence points at slice 0's NEW SOP UID
    ref = {ds.ReferencedImageSequence[0].ReferencedSOPInstanceUID for ds in datasets}
    assert ref == {datasets[0].SOPInstanceUID}  # frame 0 is the z=0 slice (original sops[0])


def test_uid_map_is_keyed_and_deterministic():
    m1, m2, m3 = UidMapper(b"k" * 32), UidMapper(b"k" * 32), UidMapper(b"x" * 32)
    uid = UID_ROOT + "42"
    assert m1(uid) == m2(uid) != m3(uid)
    assert m1(uid) != m1(uid + "1")


def test_series_sorted_by_geometry_not_instance_number(pipeline):
    corpus = pipeline.corpus
    dcm, datasets, _groups, _ = series_outputs(pipeline)
    z = [float(ds.ImagePositionPatient[2]) for ds in datasets]
    assert z == sorted(corpus.dicom["zs"])
    assert [int(ds.InstanceNumber) for ds in datasets] == corpus.dicom["instance_numbers"]  # 3,1,4,2: not sorted
    assert dcm["dicom"]["sortedBy"] == "image_position_patient" and dcm["dicom"]["geometryValidated"] is True
    for k, ds in enumerate(datasets):  # pixel data untouched and in geometric order
        expected = ((np.arange(64 * 64).reshape(64, 64) % 200) + k * 500).astype(np.uint16).tobytes()
        assert ds.PixelData == expected


def test_dicom_metadata_shape(pipeline):
    dcm, _datasets, _groups, _ = series_outputs(pipeline)
    d = dcm["dicom"]
    assert d["transferSyntaxUid"] == "1.2.840.10008.1.2.1"
    assert d["photometricInterpretation"] == "MONOCHROME2"
    assert (d["rows"], d["columns"], d["bitsAllocated"]) == (64, 64, 16)
    assert d["pixelSpacing"] == [0.9, 0.9] and d["sliceThickness"] == 5.0
    assert d["windowPresets"] == [{"label": "Window 1", "center": 300.0, "width": 600.0}]
    assert dcm["deidentification"]["privateAttributesRemoved"] == 8
    assert dcm["deidentification"]["pixelDataModified"] is False


def test_residual_risks_flagged(pipeline):
    dcm, _datasets, _groups, _ = series_outputs(pipeline)
    texts = [(f["severity"], f["finding"]) for f in dcm["findings"]]
    assert any(s == "medium" and "ContrastBolusAgent still contains text" in t for s, t in texts)
    assert any("recognizable features risk" in t for _, t in texts)
    assert not any(s == "high" for s, _ in texts)


def test_rendered_frames_labelled(pipeline):
    _dcm, datasets, groups, by_id = series_outputs(pipeline)
    rendered = next(g for g in groups if g["variant"] == "rendered")
    assert "Rendered derivative" in rendered["notes"] and rendered["preservesDiagnosticContent"] is False
    first = by_id[rendered["derivativeIds"][0]]
    img = Image.open(pipeline.deriv / first["file"])
    assert img.size == (64, 64) and img.mode == "L"
    # linear VOI (PS3.3 C.11.2.1.2) with centre 300 / width 600: stored 0 -> 0, stored 64 -> 27
    arr = np.asarray(img)
    expected = round(((64 - 299.5) / 599 + 0.5) * 255)
    assert arr[0, 0] == 0 and arr[1, 0] == expected


def _instances(datasets):
    out = []
    for n, ds in enumerate(datasets):
        src = SourceFile(path=None, rel=f"x{n}", sha256=f"{n:064d}", size=0, detected="dicom")
        out.append(make_instance(src, ds))
    return out


def _slice(k, z, inst):
    uids = {"study": UID_ROOT + "5001", "series": UID_ROOT + "5002", "for": UID_ROOT + "5003"}
    return mr_slice(k, z, inst, UID_ROOT + f"60{k}", UID_ROOT + "600", uids)


def test_fallback_to_instance_number_when_geometry_missing():
    slices = [_slice(k, 5.0 * k, inst) for k, inst in enumerate([3, 1, 2])]
    del slices[1].ImagePositionPatient
    ordered, sorted_by, validated, notes = sort_instances(_instances(slices))
    assert sorted_by == "instance_number" and validated is False
    assert [i.instance_number for i in ordered] == [1, 2, 3]
    assert any("InstanceNumber" in n for n in notes)


def test_fallback_when_orientation_inconsistent():
    slices = [_slice(k, 5.0 * k, k + 1) for k in range(3)]
    slices[2].ImageOrientationPatient = [0, 1, 0, 0, 0, -1]
    _ordered, sorted_by, validated, _ = sort_instances(_instances(slices))
    assert (sorted_by, validated) == ("instance_number", False)


def test_oblique_geometry_sorted_along_normal():
    slices = []
    normal = np.cross([1, 0, 0], [0, 0.8, 0.6])
    for k, d in enumerate([10.0, -5.0, 0.0, 5.0]):
        s = _slice(k, 0.0, k + 1)
        s.ImageOrientationPatient = [1, 0, 0, 0, 0.8, 0.6]
        s.ImagePositionPatient = [float(v) for v in np.array([3.0, 4.0, 0.0]) + d * normal]
        slices.append(s)
    ordered, sorted_by, validated, _ = sort_instances(_instances(slices))
    assert sorted_by == "image_position_patient" and validated
    assert [i.instance_number for i in ordered] == [2, 3, 4, 1]


def test_unsupported_transfer_syntax_rejected_with_clear_message():
    ds = _slice(0, 0.0, 1)
    ds.file_meta.TransferSyntaxUID = JPEG2000Lossless
    with pytest.raises(UnsupportedDicomError) as exc:
        check_transfer_syntax(ds, "series 9")
    msg = str(exc.value)
    assert "Unsupported transfer syntax 1.2.840.10008.1.2.4.90" in msg
    assert "JPEG 2000" in msg and "1.2.840.10008.1.2 (Implicit VR Little Endian)" in msg
    assert "series 9" in msg


def test_unsupported_photometric_rejected():
    ds = _slice(0, 0.0, 1)
    ds.PhotometricInterpretation = "YBR_FULL"
    with pytest.raises(UnsupportedDicomError, match="PhotometricInterpretation"):
        validate_for_display(ds)


def test_burned_in_annotation_flagged_and_deid_report():
    ds = _slice(0, 0.0, 1)
    ds.BurnedInAnnotation = "YES"
    ds.ImageComments = "patient Jane"
    report = deidentify(ds, UidMapper(b"z" * 32))
    assert "ImageComments" in report["removed"] and report["privateRemoved"] == 2
    findings = scan_deidentified(ds, "series 2")
    assert any(f.severity == "high" and "BurnedInAnnotation=YES" in f.finding for f in findings)


def test_person_names_inside_sequences_removed():
    ds = _slice(0, 0.0, 1)
    item = Dataset()
    item.AccessionNumber = "ACC1"
    item.RequestedProcedureDescription = "Brain for Jane Doe"
    ds.RequestAttributesSequence = [item]
    other = Dataset()
    other.ReferencedSOPInstanceUID = UID_ROOT + "77"
    other.PatientName = "Nested^Name"
    ds.SourceImageSequence = [other]
    ds2 = copy.deepcopy(ds)
    deidentify(ds2, UidMapper(b"z" * 32))
    assert "RequestAttributesSequence" not in ds2
    assert str(ds2.SourceImageSequence[0].PatientName) == ""
    assert ds2.SourceImageSequence[0].ReferencedSOPInstanceUID != UID_ROOT + "77"


def test_uid_map_persisted_in_quarantine_and_rerun_is_stable(pipeline, tmp_path):
    uid_map = json.loads((pipeline.qdir / "uid-map.json").read_text())["map"]
    assert pipeline.corpus.dicom["uids"]["study"] in uid_map
    out = tmp_path / "deriv2"
    assert cli_main(["-q", "extract", str(pipeline.qdir), "--out", str(out), "--no-ocr"]) == 0
    doc = json.loads((out / "derivatives.json").read_text())
    mr_sid = dicom_row(pipeline.inventory, "MR")["sourceFileId"]
    files = [out / d["file"] for d in doc["derivatives"] if d["sourceFileId"] == mr_sid and d["mimeType"] == "application/dicom"]
    _g, first_run, _groups, _ = series_outputs(pipeline)
    assert [pydicom.dcmread(f).SOPInstanceUID for f in files] == [ds.SOPInstanceUID for ds in first_run]


def test_deidentified_file_reads_back(pipeline):
    _g, datasets, _groups, _ = series_outputs(pipeline)
    buf = io.BytesIO()
    datasets[0].save_as(buf, enforce_file_format=True)
    assert pydicom.dcmread(io.BytesIO(buf.getvalue())).PatientIdentityRemoved == "YES"


def test_profile_table_keywords_resolve_and_unknown_public_tags_removed():
    from ingest.dicom_deid import UNKNOWN_KEYWORDS

    assert UNKNOWN_KEYWORDS == []  # every keyword in the documented table exists in the dictionary
    ds = _slice(0, 0.0, 1)
    ds.add_new((0x0010, 0x9FF0), "LO", "Jane Doe alias")  # public group, not in the data dictionary
    report = deidentify(ds, UidMapper(b"z" * 32))
    assert (0x0010, 0x9FF0) not in ds and report["unknownPublicRemoved"] == 1
