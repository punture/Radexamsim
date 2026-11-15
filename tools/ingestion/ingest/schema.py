"""Strict validator for the ``sim-case-import@1`` package format (used before writing)."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path, PurePosixPath
from typing import Any

FORMAT = "sim-case-import@1"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")

TOP_KEYS = [
    "format", "caseId", "caseFamilyId", "internalTitle", "sourceDiagnosis", "diagnosticBasis", "truthStatus",
    "sourceReferences", "assets", "teachingText", "privacyFindings", "privacyStatus", "notes",
]
SOURCE_REF_KEYS = ["id", "kind", "sourceFileId", "locator", "description"]
ASSET_KEYS = ["id", "kind", "modality", "neutralLabel", "sequence", "plane", "contrast", "frames", "derivation", "dicom"]
FRAME_KEYS = ["index", "file", "mimeType", "width", "height", "sha256", "byteSize"]
DERIVATION_KEYS = ["sourceReferenceId", "method", "notes", "preservesDiagnosticContent", "burnedInAnnotationsPresent"]
DICOM_KEYS = [
    "transferSyntaxUid", "photometricInterpretation", "rows", "columns", "bitsAllocated", "rescaleSlope",
    "rescaleIntercept", "pixelSpacing", "sliceThickness", "imageOrientationPatient", "sortedBy",
    "geometryValidated", "windowPresets",
]
WINDOW_KEYS = ["label", "center", "width"]
FINDING_KEYS = ["severity", "location", "finding"]

SOURCE_KINDS = {"pptx_slide", "image_file", "pdf_page", "dicom_series", "cine_clip"}
ASSET_KINDS = {"still", "stack", "cine", "dicom_stack"}
MODALITIES = {"CT", "CTA", "CTP", "MR", "MRA", "MRV", "DSA", "US", "XR", "NM", "PET", "other"}
MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "application/dicom"}
METHODS = {"original_embedded", "format_converted", "dicom_export"}
TRUTH = {"confirmed", "probable", "differential_only", None}
EXT_FOR_MIME = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "application/dicom": ".dcm"}


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _str_or_none(v: Any) -> bool:
    return v is None or isinstance(v, str)


def _keys(obj: Any, expected: list[str], where: str, errors: list[str]) -> bool:
    if not isinstance(obj, dict):
        errors.append(f"{where}: must be an object")
        return False
    missing = [k for k in expected if k not in obj]
    extra = [k for k in obj if k not in expected]
    if missing:
        errors.append(f"{where}: missing keys {missing}")
    if extra:
        errors.append(f"{where}: unexpected keys {extra}")
    return not missing


def validate_case_import(doc: Any, pkg_dir: Path | None = None) -> list[str]:
    errors: list[str] = []
    if not _keys(doc, TOP_KEYS, "package", errors):
        return errors
    if doc["format"] != FORMAT:
        errors.append("format must be 'sim-case-import@1'")
    for key in ("caseId", "caseFamilyId"):
        if not isinstance(doc[key], str) or not SLUG_RE.match(doc[key]):
            errors.append(f"{key} must be a lowercase slug ([a-z0-9_-], max 80)")
    if not isinstance(doc["internalTitle"], str) or not doc["internalTitle"].strip() or len(doc["internalTitle"]) > 200:
        errors.append("internalTitle must be a non-empty string (max 200)")
    for key in ("sourceDiagnosis", "diagnosticBasis", "teachingText"):
        if not _str_or_none(doc[key]):
            errors.append(f"{key} must be a string or null")
    if doc["truthStatus"] not in TRUTH:
        errors.append("truthStatus must be confirmed|probable|differential_only|null")
    if doc["privacyStatus"] not in ("quarantine", "checked"):
        errors.append("privacyStatus must be quarantine|checked (the tool never approves)")
    if not isinstance(doc["notes"], str):
        errors.append("notes must be a string")

    refs = doc["sourceReferences"]
    ref_ids: set[str] = set()
    if not isinstance(refs, list) or not refs:
        errors.append("sourceReferences must be a non-empty array")
        refs = []
    for i, ref in enumerate(refs):
        where = f"sourceReferences[{i}]"
        if not _keys(ref, SOURCE_REF_KEYS, where, errors):
            continue
        if not isinstance(ref["id"], str) or not SLUG_RE.match(ref["id"]) or ref["id"] in ref_ids:
            errors.append(f"{where}.id must be a unique slug")
        ref_ids.add(ref["id"])
        if ref["kind"] not in SOURCE_KINDS:
            errors.append(f"{where}.kind invalid")
        if not isinstance(ref["sourceFileId"], str) or not re.fullmatch(r"[a-f0-9]{8,64}", ref["sourceFileId"]):
            errors.append(f"{where}.sourceFileId must be a sha256 prefix")
        if not isinstance(ref["locator"], str) or not ref["locator"]:
            errors.append(f"{where}.locator must be a non-empty string")
        if not isinstance(ref["description"], str) or not ref["description"].strip():
            errors.append(f"{where}.description must be non-empty")

    assets = doc["assets"]
    asset_ids: set[str] = set()
    if not isinstance(assets, list) or not assets:
        errors.append("assets must be a non-empty array")
        assets = []
    for i, asset in enumerate(assets):
        where = f"assets[{i}]"
        if not _keys(asset, ASSET_KEYS, where, errors):
            continue
        if not isinstance(asset["id"], str) or not SLUG_RE.match(asset["id"]) or asset["id"] in asset_ids:
            errors.append(f"{where}.id must be a unique slug")
        asset_ids.add(asset["id"])
        if asset["kind"] not in ASSET_KINDS:
            errors.append(f"{where}.kind invalid")
        if asset["modality"] not in MODALITIES:
            errors.append(f"{where}.modality invalid")
        if not isinstance(asset["neutralLabel"], str) or not asset["neutralLabel"].strip() or len(asset["neutralLabel"]) > 120:
            errors.append(f"{where}.neutralLabel must be non-empty (max 120)")
        for key in ("sequence", "plane", "contrast"):
            if not _str_or_none(asset[key]):
                errors.append(f"{where}.{key} must be a string or null")
        frames = asset["frames"]
        if not isinstance(frames, list) or not frames:
            errors.append(f"{where}.frames must be a non-empty array")
            frames = []
        if asset["kind"] == "still" and len(frames) != 1:
            errors.append(f"{where}: a still must have exactly one frame")
        if asset["kind"] in ("stack", "cine") and len(frames) < 2:
            errors.append(f"{where}: a {asset['kind']} must have multiple frames")
        for j, fr in enumerate(frames):
            fw = f"{where}.frames[{j}]"
            if not _keys(fr, FRAME_KEYS, fw, errors):
                continue
            if fr["index"] != j:
                errors.append(f"{fw}.index must be {j}")
            if fr["mimeType"] not in MIME_TYPES:
                errors.append(f"{fw}.mimeType invalid")
            if asset["kind"] == "dicom_stack" and fr["mimeType"] != "application/dicom":
                errors.append(f"{fw}: dicom_stack frames must be application/dicom")
            f = fr["file"]
            path_ok = isinstance(f, str) and not f.startswith("/") and ".." not in PurePosixPath(f).parts and "\\" not in f
            if not path_ok:
                errors.append(f"{fw}.file must be a relative path inside the package")
            elif not f.startswith(f"frames/{asset['id']}/"):
                errors.append(f"{fw}.file must live under frames/{asset['id']}/")
            elif fr["mimeType"] in EXT_FOR_MIME and not f.endswith(EXT_FOR_MIME[fr["mimeType"]]):
                errors.append(f"{fw}.file extension does not match mimeType")
            for key in ("width", "height", "byteSize"):
                if not _is_int(fr[key]) or fr[key] <= 0:
                    errors.append(f"{fw}.{key} must be a positive integer")
            if not isinstance(fr["sha256"], str) or not SHA_RE.match(fr["sha256"]):
                errors.append(f"{fw}.sha256 must be 64 lowercase hex characters")
            if pkg_dir is not None and path_ok:
                path = Path(pkg_dir) / f
                if not path.is_file():
                    errors.append(f"{fw}: file missing from package")
                else:
                    data = path.read_bytes()
                    if hashlib.sha256(data).hexdigest() != fr["sha256"] or len(data) != fr["byteSize"]:
                        errors.append(f"{fw}: file content does not match sha256/byteSize")
        der = asset["derivation"]
        if _keys(der, DERIVATION_KEYS, f"{where}.derivation", errors):
            if der["sourceReferenceId"] not in ref_ids:
                errors.append(f"{where}.derivation.sourceReferenceId unknown")
            if der["method"] not in METHODS:
                errors.append(f"{where}.derivation.method invalid")
            if not isinstance(der["notes"], str):
                errors.append(f"{where}.derivation.notes must be a string")
            for key in ("preservesDiagnosticContent", "burnedInAnnotationsPresent"):
                if not isinstance(der[key], bool):
                    errors.append(f"{where}.derivation.{key} must be boolean")
        dicom = asset["dicom"]
        if asset["kind"] == "dicom_stack" and dicom is None:
            errors.append(f"{where}: dicom_stack requires dicom metadata")
        if dicom is not None:
            errors.extend(validate_dicom(dicom, f"{where}.dicom"))

    findings = doc["privacyFindings"]
    if not isinstance(findings, list):
        errors.append("privacyFindings must be an array")
        findings = []
    for i, f in enumerate(findings):
        where = f"privacyFindings[{i}]"
        if not _keys(f, FINDING_KEYS, where, errors):
            continue
        if f["severity"] not in ("high", "medium", "low"):
            errors.append(f"{where}.severity invalid")
        if not isinstance(f["location"], str) or not isinstance(f["finding"], str) or not f["finding"]:
            errors.append(f"{where}: location/finding must be strings")
    if doc["privacyStatus"] == "checked":
        if any(isinstance(f, dict) and f.get("severity") == "high" for f in findings):
            errors.append("privacyStatus 'checked' is not allowed while a high-severity finding remains")
        if doc["teachingText"] is not None:
            errors.append("privacyStatus 'checked' is not allowed when source text is included")
    return errors


def validate_dicom(d: Any, where: str) -> list[str]:
    errors: list[str] = []
    if not _keys(d, DICOM_KEYS, where, errors):
        return errors
    if not isinstance(d["transferSyntaxUid"], str) or not d["transferSyntaxUid"]:
        errors.append(f"{where}.transferSyntaxUid must be a non-empty string")
    if d["photometricInterpretation"] not in ("MONOCHROME1", "MONOCHROME2", "RGB"):
        errors.append(f"{where}.photometricInterpretation invalid")
    for key in ("rows", "columns", "bitsAllocated"):
        if not _is_int(d[key]) or d[key] <= 0:
            errors.append(f"{where}.{key} must be a positive integer")
    for key in ("rescaleSlope", "rescaleIntercept"):
        if not _is_num(d[key]):
            errors.append(f"{where}.{key} must be a number")
    ps = d["pixelSpacing"]
    if ps is not None and (not isinstance(ps, list) or len(ps) != 2 or not all(_is_num(v) and v > 0 for v in ps)):
        errors.append(f"{where}.pixelSpacing must be [row, col] positive numbers or null")
    st = d["sliceThickness"]
    if st is not None and (not _is_num(st) or st <= 0):
        errors.append(f"{where}.sliceThickness must be a positive number or null")
    iop = d["imageOrientationPatient"]
    if iop is not None and (not isinstance(iop, list) or len(iop) != 6 or not all(_is_num(v) for v in iop)):
        errors.append(f"{where}.imageOrientationPatient must be 6 numbers or null")
    if d["sortedBy"] not in ("image_position_patient", "instance_number"):
        errors.append(f"{where}.sortedBy invalid")
    if not isinstance(d["geometryValidated"], bool):
        errors.append(f"{where}.geometryValidated must be boolean")
    if d["sortedBy"] == "instance_number" and d["geometryValidated"] is True:
        errors.append(f"{where}: geometryValidated must be false when sorted by instance_number")
    wp = d["windowPresets"]
    if not isinstance(wp, list):
        errors.append(f"{where}.windowPresets must be an array")
        wp = []
    for i, w in enumerate(wp):
        ww = f"{where}.windowPresets[{i}]"
        if not _keys(w, WINDOW_KEYS, ww, errors):
            continue
        if not isinstance(w["label"], str) or not w["label"].strip():
            errors.append(f"{ww}.label must be non-empty")
        if not _is_num(w["center"]) or not _is_num(w["width"]) or w["width"] <= 0:
            errors.append(f"{ww}: center must be a number and width a positive number")
    return errors
