"""DICOM series grouping, geometry validation/sorting, display metadata and PNG rendering."""

from __future__ import annotations

import io
import math
import re
from collections import defaultdict
from typing import Any

import numpy as np
import pydicom
from PIL import Image
from pydicom.dataset import Dataset
from pydicom.multival import MultiValue

from ingest.dicom_deid import (
    UnsupportedDicomError,
    pixel_risk_findings,
    source_phi_findings,
    source_value_findings,
    transfer_syntax_of,
    validate_for_display,
)
from ingest.model import DicomInstance, Finding, SourceFile, Unit
from ingest.phi import safe_descriptor
from ingest.util import sha256_bytes

NON_IMAGE_SOP_PREFIXES = (
    "1.2.840.10008.5.1.4.1.1.88.",  # structured reports
    "1.2.840.10008.5.1.4.1.1.11.",  # presentation states
    "1.2.840.10008.5.1.4.1.1.104.",  # encapsulated documents
    "1.2.840.10008.5.1.4.1.1.66",  # raw data / registration / segmentation
    "1.2.840.10008.5.1.4.1.1.481.",  # RT objects (non-image)
)
DICOMDIR_SOP = "1.2.840.10008.1.3.10"

MODALITY_MAP = {
    "CT": "CT", "MR": "MR", "US": "US", "NM": "NM", "PT": "PET", "XA": "DSA", "RF": "XR", "CR": "XR",
    "DX": "XR", "DR": "XR", "MG": "XR", "IO": "XR", "PX": "XR",
}
HEAD_NECK_BODY_PARTS = {
    "HEAD", "BRAIN", "SKULL", "NECK", "HEADNECK", "HEAD_NECK", "NECKHEAD", "FACE", "ORBIT", "SINUS", "IAC",
    "TMJ", "JAW", "MANDIBLE", "MAXILLA", "CSPINE", "CAROTID", "EAR", "EYE", "NOSE", "LARYNX", "PHARYNX",
    "NASOPHARYNX", "OROPHARYNX", "CIRCLEOFWILLIS", "PITUITARY",
}
GENERIC_PATIENT_ID = re.compile(
    r"^(?:|0+|x+|n/?a|none|null|unknown|test|patient|anon\w*|de-?ident\w*|deid\w*|removed|redacted|blank|"
    r"case|teaching|research|phantom)$",
    re.I,
)
HEAD_NECK_TERMS = re.compile(
    r"\b(head|brain|neck|face|facial|orbits?|sinus(es)?|skull|iac|temporal\s*bone|maxillofacial|mandible|"
    r"cervical|c-?spine|pituitary|sella|neuro|cranial|intracranial|carotid|willis|tmj|dental|cerebral)\b",
    re.I,
)


def read_header(path, force_ok: bool = True) -> Dataset:
    try:
        return pydicom.dcmread(str(path), stop_before_pixels=True)
    except pydicom.errors.InvalidDicomError:
        if not force_ok:
            raise
        return pydicom.dcmread(str(path), stop_before_pixels=True, force=True)


def read_full(path) -> Dataset:
    try:
        return pydicom.dcmread(str(path))
    except pydicom.errors.InvalidDicomError:
        return pydicom.dcmread(str(path), force=True)


def _floats(value, n: int) -> list[float] | None:
    if value is None:
        return None
    try:
        vals = [float(v) for v in (value if isinstance(value, (list, tuple, MultiValue)) else [value])]
    except (TypeError, ValueError):
        return None
    if len(vals) != n or any(math.isnan(v) or math.isinf(v) for v in vals):
        return None
    return vals


def _int_or_none(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def classify_header(ds: Dataset) -> str | None:
    """Return a reason string if the object is not an image this tool handles, else None."""
    sop_class = str(getattr(ds, "SOPClassUID", "") or "")
    meta_class = str(getattr(getattr(ds, "file_meta", None), "MediaStorageSOPClassUID", "") or "")
    if sop_class == DICOMDIR_SOP or meta_class == DICOMDIR_SOP or "DirectoryRecordSequence" in ds:
        return "DICOMDIR index file (patient-level records); not processed"
    if any(sop_class.startswith(p) for p in NON_IMAGE_SOP_PREFIXES):
        return "non-image DICOM object (structured report, presentation state, document or RT); not processed"
    if "Rows" not in ds or "Columns" not in ds:
        return "DICOM object without image attributes (Rows/Columns); not processed"
    return None


def make_instance(src: SourceFile, ds: Dataset) -> DicomInstance:
    return DicomInstance(
        source=src,
        sop_instance_uid=str(getattr(ds, "SOPInstanceUID", "") or ""),
        instance_number=_int_or_none(getattr(ds, "InstanceNumber", None)),
        ipp=_floats(getattr(ds, "ImagePositionPatient", None), 3),
        iop=_floats(getattr(ds, "ImageOrientationPatient", None), 6),
        header=ds,
    )


def sort_instances(instances: list[DicomInstance]) -> tuple[list[DicomInstance], str, bool, list[str]]:
    """Sort by projection of ImagePositionPatient onto the slice normal when geometry is
    consistent; otherwise fall back to InstanceNumber (geometryValidated=False)."""
    notes: list[str] = []
    multi_frame = any(int(getattr(i.header, "NumberOfFrames", 1) or 1) > 1 for i in instances)
    reason = None
    if multi_frame:
        reason = "multi-frame instance(s): per-frame geometry not validated"
    elif not all(i.iop and i.ipp for i in instances):
        reason = "ImagePositionPatient/ImageOrientationPatient missing on some instances"
    else:
        ref = np.array(instances[0].iop)
        if any(np.max(np.abs(np.array(i.iop) - ref)) > 1e-3 for i in instances):
            reason = "ImageOrientationPatient differs between instances"
        else:
            row, col = ref[:3], ref[3:]
            if abs(np.linalg.norm(row) - 1) > 1e-2 or abs(np.linalg.norm(col) - 1) > 1e-2 or abs(np.dot(row, col)) > 1e-2:
                reason = "ImageOrientationPatient is not orthonormal"
            else:
                normal = np.cross(row, col)
                dist = [float(np.dot(np.array(i.ipp), normal)) for i in instances]
                order = sorted(range(len(instances)), key=lambda k: dist[k])
                sd = [dist[k] for k in order]
                gaps = [b - a for a, b in zip(sd, sd[1:])]
                if gaps and min(gaps) < 1e-3:
                    reason = "duplicate slice positions along the slice normal"
                else:
                    if len(gaps) >= 2:
                        mean_gap = sum(gaps) / len(gaps)
                        if max(gaps) - min(gaps) > max(0.05 * mean_gap, 0.1):
                            notes.append("non-uniform slice spacing: possible missing slices or gaps")
                    inplane = [np.array(instances[k].ipp) - dist[k] * normal for k in order]
                    if len(inplane) >= 2 and max(float(np.linalg.norm(p - inplane[0])) for p in inplane) > 1.0:
                        notes.append("slice positions shift in-plane (gantry tilt or oblique stack)")
                    return [instances[k] for k in order], "image_position_patient", True, notes
    notes.append(f"sorted by InstanceNumber: {reason}")
    ordered = sorted(
        enumerate(instances),
        key=lambda e: (e[1].instance_number is None, e[1].instance_number or 0, e[0]),
    )
    numbers = [i.instance_number for _, i in ordered if i.instance_number is not None]
    if numbers and len(set(numbers)) != len(numbers):
        notes.append("duplicate InstanceNumber values")
    return [i for _, i in ordered], "instance_number", False, notes


def window_presets(ds: Dataset) -> list[dict[str, Any]]:
    centers = getattr(ds, "WindowCenter", None)
    widths = getattr(ds, "WindowWidth", None)
    if centers is None or widths is None:
        return []
    cs = list(centers) if isinstance(centers, (list, MultiValue)) else [centers]
    ws = list(widths) if isinstance(widths, (list, MultiValue)) else [widths]
    expl = getattr(ds, "WindowCenterWidthExplanation", None)
    labels = list(expl) if isinstance(expl, (list, MultiValue)) else ([expl] if expl else [])
    presets = []
    for k, (c, w) in enumerate(zip(cs, ws)):
        try:
            c, w = float(c), float(w)
        except (TypeError, ValueError):
            continue
        if w <= 0 or math.isnan(c) or math.isnan(w):
            continue
        label = None
        if k < len(labels) and labels[k]:
            label = safe_descriptor(str(labels[k]), max_len=32)
        presets.append({"label": label or f"Window {k + 1}", "center": c, "width": w})
    return presets


def series_metadata(ordered: list[DicomInstance], sorted_by: str, validated: bool) -> dict[str, Any]:
    ds = ordered[0].header
    slope = getattr(ds, "RescaleSlope", None)
    intercept = getattr(ds, "RescaleIntercept", None)
    ps = _floats(getattr(ds, "PixelSpacing", None), 2)
    if ps and any(v <= 0 for v in ps):
        ps = None
    thickness = getattr(ds, "SliceThickness", None)
    try:
        thickness = float(thickness) if thickness not in (None, "") else None
    except (TypeError, ValueError):
        thickness = None
    if thickness is not None and thickness <= 0:
        thickness = None
    return {
        "transferSyntaxUid": transfer_syntax_of(ds) or "",
        "photometricInterpretation": str(getattr(ds, "PhotometricInterpretation", "")),
        "rows": int(ds.Rows),
        "columns": int(ds.Columns),
        "bitsAllocated": int(getattr(ds, "BitsAllocated", 0) or 0),
        "rescaleSlope": float(slope) if slope not in (None, "") else 1.0,
        "rescaleIntercept": float(intercept) if intercept not in (None, "") else 0.0,
        "pixelSpacing": ps,
        "sliceThickness": thickness,
        "imageOrientationPatient": _floats(getattr(ds, "ImageOrientationPatient", None), 6),
        "sortedBy": sorted_by,
        "geometryValidated": bool(validated),
        "windowPresets": window_presets(ds),
    }


def face_risk(ordered: list[DicomInstance], location: str) -> Finding | None:
    ds = ordered[0].header
    modality = str(getattr(ds, "Modality", "") or "").upper()
    photo = modality in ("XC", "VL", "GM", "ES", "OP")
    if modality not in ("CT", "MR", "PT", "NM") and not photo:
        return None
    body = re.sub(r"[^A-Z]", "", str(getattr(ds, "BodyPartExamined", "") or "").upper())
    descriptions = " ".join(
        str(getattr(ds, k, "") or "") for k in ("StudyDescription", "SeriesDescription", "ProtocolName")
    )
    head_neck = body in HEAD_NECK_BODY_PARTS or bool(HEAD_NECK_TERMS.search(descriptions))
    unknown = not body and not descriptions.strip()
    if not (head_neck or unknown):
        return None
    frames = sum(int(getattr(i.header, "NumberOfFrames", 1) or 1) for i in ordered)
    thickness = getattr(ds, "SliceThickness", None)
    try:
        thickness = float(thickness) if thickness not in (None, "") else None
    except (TypeError, ValueError):
        thickness = None
    scope = "head/neck" if head_neck else "possibly head/neck (body part not stated)"
    if photo:
        return Finding(
            "high", location,
            f"recognizable features risk: {scope} photograph-type DICOM ({modality}); owner decision required",
            "recognizable_features", "content",
        )
    if frames >= 20 and (thickness is None or thickness <= 3.0):
        thk = f"{thickness:g} mm" if thickness is not None else "unknown thickness"
        return Finding(
            "high", location,
            f"recognizable features risk: volumetric {scope} {modality} ({frames} slices, {thk}) could allow facial "
            "surface reconstruction; not defaced - owner decision required",
            "recognizable_features", "content",
        )
    return Finding(
        "medium", location,
        f"recognizable features risk: {scope} {modality} series ({frames} image(s)); check for facial features - owner decision required",
        "recognizable_features", "content",
    )


def build_series_units(instances: list[DicomInstance], institutions=()) -> list[Unit]:
    """Group instances into series units (grouping keys stay private, never output)."""
    groups: dict[tuple[str, str], list[DicomInstance]] = defaultdict(list)
    for inst in instances:
        study = str(getattr(inst.header, "StudyInstanceUID", "") or "")
        series = str(getattr(inst.header, "SeriesInstanceUID", "") or "") or f"no-series-{inst.source.sha256}"
        groups[(study, series)].append(inst)
    units: list[Unit] = []
    ordinal = 0
    keys = sorted(groups, key=lambda k: min(i.source.rel for i in groups[k]))
    for key in keys:
        members = groups[key]
        ordinal += 1
        shas = sorted({i.source.sha256 for i in members})
        series_id = sha256_bytes("\n".join(shas).encode("ascii"))[:16]
        first = members[0].header
        number = _int_or_none(getattr(first, "SeriesNumber", None))
        locator = f"series {number}" if number is not None else f"series {ordinal}"
        unit = Unit(kind="dicom_series", source_id=series_id, locator=locator)
        unit.source_files = sorted({i.source.sha256: i.source for i in members}.values(), key=lambda s: s.rel)
        unit.group_keys = {f"study:{key[0]}"} if key[0] else set()
        patient_id = str(getattr(first, "PatientID", "") or "").strip()
        if len(patient_id) >= 3 and not GENERIC_PATIENT_ID.match(patient_id):
            unit.group_keys.add(f"patient:{patient_id}")  # placeholder IDs (e.g. ANONYMOUS) never merge cases
        modality = str(getattr(first, "Modality", "") or "").upper() or None
        unit.modality_hint = modality
        unit.teaching_annotations = None
        sop_uids = [i.sop_instance_uid for i in members]
        if len(set(sop_uids)) != len(sop_uids):
            unit.notes.append("duplicate SOPInstanceUID values in series (duplicates kept as separate files)")

        summary: dict[str, Any] = {"supported": True, "rejectReason": None}
        try:
            notes: set[str] = set()
            for inst in members:
                notes.update(validate_for_display(inst.header, where=locator))
            unit.notes.extend(sorted(notes))
            for attr in ("Rows", "Columns", "BitsAllocated", "PhotometricInterpretation", "SamplesPerPixel"):
                values = {str(getattr(i.header, attr, "")) for i in members}
                if len(values) > 1:
                    raise UnsupportedDicomError(f"{locator}: {attr} differs between instances of the series")
        except UnsupportedDicomError as exc:
            summary["supported"] = False
            summary["rejectReason"] = str(exc)
            unit.missing.append(str(exc))

        ordered, sorted_by, validated, sort_notes = sort_instances(members)
        unit.dicom_instances = ordered
        unit.notes.extend(sort_notes)
        if any("missing slices" in n for n in sort_notes):
            unit.missing.append("possible missing slices (non-uniform spacing)")
        if summary["supported"]:
            summary["metadata"] = series_metadata(ordered, sorted_by, validated)
            slopes = {str(getattr(i.header, "RescaleSlope", "")) for i in ordered}
            if len(slopes) > 1:
                unit.notes.append("RescaleSlope varies between instances (per-instance values kept in each file)")
        frames = sum(int(getattr(i.header, "NumberOfFrames", 1) or 1) for i in ordered)
        summary["instanceCount"] = len(ordered)
        summary["frameCount"] = frames
        summary["modality"] = modality
        summary["rows"] = _int_or_none(getattr(first, "Rows", None))
        summary["columns"] = _int_or_none(getattr(first, "Columns", None))
        summary["bitsStored"] = _int_or_none(getattr(first, "BitsStored", None))
        summary["transferSyntaxUid"] = transfer_syntax_of(first)
        summary["sortedBy"] = sorted_by
        summary["geometryValidated"] = validated
        descriptor = safe_descriptor(str(getattr(first, "SeriesDescription", "") or ""))
        summary["safeSeriesDescription"] = descriptor
        unit.dicom_summary = summary
        if len(ordered) == 1 and frames == 1:
            unit.notes.append("series has a single image")

        phi: dict[str, Finding] = {}
        for inst in ordered:
            for f in (
                source_phi_findings(inst.header, locator)
                + source_value_findings(inst.header, locator, institutions)
                + pixel_risk_findings(inst.header, locator)
            ):
                phi.setdefault(f.finding, f)
        unit.findings.extend(phi.values())
        risk = face_risk(ordered, locator)
        if risk:
            unit.findings.append(risk)
        label = f"DICOM series {number if number is not None else ordinal} ({modality or 'unknown modality'}, {len(ordered)} image(s)"
        if descriptor:
            label += f", '{descriptor}'"
        unit.label = label + ")"
        units.append(unit)
    return units


# ---------------------------------------------------------------------------
# Rendering (labelled as rendered derivatives; never used as the diagnostic original)
# ---------------------------------------------------------------------------


def render_frames(ds: Dataset, center: float | None, width: float | None) -> list[tuple[bytes, int, int]]:
    arr = ds.pixel_array
    pi = str(ds.PhotometricInterpretation)
    frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
    if pi == "RGB":
        stack = arr if frames > 1 else arr[np.newaxis, ...]
        out = []
        for fr in stack:
            img = Image.fromarray(np.ascontiguousarray(fr.astype(np.uint8)))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            out.append((buf.getvalue(), img.size[0], img.size[1]))
        return out
    stack = arr if frames > 1 else arr[np.newaxis, ...]
    slope = float(getattr(ds, "RescaleSlope", 1) or 1)
    intercept = float(getattr(ds, "RescaleIntercept", 0) or 0)
    out = []
    for fr in stack:
        x = fr.astype(np.float64) * slope + intercept
        if center is not None and width is not None and width > 1:
            c, w = float(center), float(width)
            y = ((x - (c - 0.5)) / (w - 1) + 0.5) * 255.0
            y[x <= c - 0.5 - (w - 1) / 2] = 0.0
            y[x > c - 0.5 + (w - 1) / 2] = 255.0
        elif center is not None and width is not None:
            y = np.where(x < float(center) - 0.5, 0.0, 255.0)
        else:
            lo, hi = float(x.min()), float(x.max())
            y = (x - lo) * (255.0 / (hi - lo)) if hi > lo else np.zeros_like(x)
        if pi == "MONOCHROME1":
            y = 255.0 - y
        img = Image.fromarray(np.clip(np.rint(y), 0, 255).astype(np.uint8))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append((buf.getvalue(), img.size[0], img.size[1]))
    return out
