"""DICOM de-identification: a documented SUBSET of the PS3.15 Annex E Basic Application
Level Confidentiality Profile, plus display validation and residual-risk checks.

What this does (see README for the full table):
  * removes (X) or blanks (Z) patient, physician, operator, institution, device and
    request/visit identifying attributes, wherever they occur (including in sequences);
  * removes ALL private attributes, overlay planes (60xx), curves (50xx) and group lengths;
  * removes dates/times except type-2 study/content dates, which are blanked;
  * replaces every non-standard UID (Study/Series/SOP Instance, Frame of Reference, and
    references to them) through a keyed HMAC map so references stay consistent;
  * keeps SeriesDescription/ProtocolName only when every token is an acquisition term;
  * keeps pixel data and display/geometry attributes untouched;
  * sets PatientIdentityRemoved=YES, DeidentificationMethod and
    LongitudinalTemporalInformationModified=REMOVED.

What it does NOT do: it never edits pixel data (burned-in text is flagged, not removed),
never defaces, and does not claim full conformance to any PS3.15 option.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from pathlib import Path
from typing import Any

from pydicom.datadict import tag_for_keyword
from pydicom.dataset import Dataset
from pydicom.multival import MultiValue
from pydicom.uid import UID

from ingest import __version__
from ingest.model import Finding
from ingest.phi import has_identifier_like, safe_descriptor, scan_text

SUPPORTED_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2": "Implicit VR Little Endian",
    "1.2.840.10008.1.2.1": "Explicit VR Little Endian",
}
SUPPORTED_PHOTOMETRIC = ("MONOCHROME1", "MONOCHROME2", "RGB")
STANDARD_UID_ROOT = "1.2.840.10008."


class UnsupportedDicomError(Exception):
    """Raised with a clear, user-facing message when a DICOM object cannot be handled."""


# --- PS3.15 Table E.1-1 subset ----------------------------------------------------------
# Z: replace with a zero-length value (type 2 attributes).
BLANK_KEYWORDS = [
    "PatientName", "PatientID", "PatientBirthDate", "PatientSex", "ReferringPhysicianName",
    "AccessionNumber", "StudyID", "StudyDate", "StudyTime", "ContentDate", "ContentTime",
    "ContentCreatorName",
]
# X: remove.
REMOVE_KEYWORDS = [
    # patient
    "PatientBirthTime", "OtherPatientIDs", "OtherPatientIDsSequence", "OtherPatientNames", "PatientBirthName",
    "PatientMotherBirthName", "MedicalRecordLocator", "PatientAddress", "PatientTelephoneNumbers",
    "PatientTelecomInformation", "MilitaryRank", "BranchOfService", "CountryOfResidence", "RegionOfResidence",
    "EthnicGroup", "Occupation", "PatientReligiousPreference", "PatientInsurancePlanCodeSequence",
    "PatientPrimaryLanguageCodeSequence", "IssuerOfPatientID", "IssuerOfPatientIDQualifiersSequence",
    "PatientAge", "PatientSize", "PatientWeight", "AdditionalPatientHistory", "PatientComments",
    "MedicalAlerts", "Allergies", "SmokingStatus", "PregnancyStatus", "LastMenstrualDate", "PatientState",
    "SpecialNeeds", "ResponsiblePerson", "ResponsiblePersonRole", "ResponsibleOrganization",
    "ReferencedPatientSequence", "ReferencedPatientPhotoSequence", "ReferencedPatientAliasSequence",
    "PatientTransportArrangements", "PatientInstitutionResidence", "PatientAlternativeCalendar",
    "PatientBirthDateInAlternativeCalendar", "PatientDeathDateInAlternativeCalendar",
    # clinical-trial subject/site identifiers
    "ClinicalTrialSponsorName", "ClinicalTrialProtocolID", "ClinicalTrialProtocolName", "ClinicalTrialSiteID",
    "ClinicalTrialSiteName", "ClinicalTrialSubjectID", "ClinicalTrialSubjectReadingID", "ClinicalTrialTimePointID",
    "ClinicalTrialTimePointDescription", "ClinicalTrialCoordinatingCenterName", "ClinicalTrialSeriesID",
    "ClinicalTrialSeriesDescription",
    # physicians, operators, people
    "ReferringPhysicianAddress", "ReferringPhysicianTelephoneNumbers", "ReferringPhysicianIdentificationSequence",
    "ConsultingPhysicianName", "ConsultingPhysicianIdentificationSequence", "PerformingPhysicianName",
    "PerformingPhysicianIdentificationSequence", "NameOfPhysiciansReadingStudy",
    "PhysiciansReadingStudyIdentificationSequence", "PhysiciansOfRecord", "PhysiciansOfRecordIdentificationSequence",
    "OperatorsName", "OperatorIdentificationSequence", "RequestingPhysician", "ScheduledPerformingPhysicianName",
    "ScheduledPerformingPhysicianIdentificationSequence", "HumanPerformerName", "HumanPerformerOrganization",
    "PersonName", "PersonAddress", "PersonTelephoneNumbers", "PersonIdentificationCodeSequence",
    "ReviewerName", "VerifyingObserverName", "VerifyingObserverIdentificationCodeSequence",
    "VerifyingObserverSequence", "AuthorObserverSequence", "ParticipantSequence", "DistributionName",
    "DistributionAddress", "VerifyingOrganization", "PhysicianApprovingInterpretation", "InterpretationRecorder",
    "InterpretationTranscriber", "InterpretationAuthor", "InterpretationApproverSequence",
    # institution / device / location
    "InstitutionName", "InstitutionAddress", "InstitutionCodeSequence", "InstitutionalDepartmentName",
    "InstitutionalDepartmentTypeCodeSequence", "StationName", "DeviceSerialNumber", "DetectorID", "PlateID",
    "GantryID", "CassetteID", "DeviceLabel", "SoftwareVersions", "PerformedStationName", "PerformedLocation",
    "PerformedStationAETitle", "ScheduledStationName", "ScheduledStationAETitle", "ScheduledProcedureStepLocation",
    "StationAETitle", "RetrieveAETitle", "ModifyingDeviceID", "ModifyingDeviceManufacturer",
    # visit / order / request
    "AdmissionID", "IssuerOfAdmissionIDSequence", "ServiceEpisodeID", "ServiceEpisodeDescription",
    "CurrentPatientLocation", "AdmittingDiagnosesDescription", "AdmittingDiagnosesCodeSequence",
    "DischargeDiagnosisDescription", "VisitComments", "RouteOfAdmissions", "RequestedProcedureID",
    "PerformedProcedureStepID", "ScheduledProcedureStepID", "PlacerOrderNumberImagingServiceRequest",
    "FillerOrderNumberImagingServiceRequest", "OrderEnteredBy", "OrderEntererLocation", "OrderCallbackPhoneNumber",
    "ReasonForTheRequestedProcedure", "ReasonForStudy", "RequestedProcedureComments",
    "ImagingServiceRequestComments", "StudyComments", "RequestAttributesSequence", "ReferencedStudySequence",
    "ReferencedPerformedProcedureStepSequence", "IssuerOfAccessionNumberSequence", "InterpretationText",
    "InterpretationID", "ResultsID",
    "ResultsIDIssuer", "InterpretationIDIssuer",
    # free-text descriptors and other content
    "PerformedProcedureStepDescription", "RequestedProcedureDescription", "ScheduledProcedureStepDescription",
    "StudyDescription", "ImageComments", "AcquisitionComments", "DerivationDescription", "FrameComments",
    "AcquisitionDeviceProcessingDescription", "IdentifyingComments", "TextComments", "TopicTitle",
    "TopicSubject", "TopicAuthor", "TopicKeywords", "ContributionDescription", "TimezoneOffsetFromUTC",
    # embedded content that can carry identifiers
    "IconImageSequence", "ContentSequence", "DigitalSignaturesSequence", "OriginalAttributesSequence",
    "DataSetTrailingPadding",
]
# Kept only if every token is an acquisition-vocabulary term (otherwise removed, as in E.1-1).
CONDITIONAL_DESCRIPTORS = ["SeriesDescription", "ProtocolName"]

UID_KEEP_KEYWORDS = {
    "SOPClassUID", "ReferencedSOPClassUID", "MediaStorageSOPClassUID", "TransferSyntaxUID",
    "AffectedSOPClassUID", "RequestedSOPClassUID", "ReferencedSOPClassUIDInFile", "CodingSchemeUID",
    "ContextGroupExtensionCreatorUID", "PrivateInformationCreatorUID", "ReferencedTransferSyntaxUIDInFile",
    "RelatedGeneralSOPClassUID", "OriginalSpecializedSOPClassUID", "ImplementationClassUID",
}
TEXT_VRS = {"LO", "SH", "ST", "LT", "UT", "UC", "PN", "AE", "UR", "AS"}
DATE_VRS = {"DA", "DT", "TM"}
SAFE_TEXT_KEYWORDS = {
    "Manufacturer", "ManufacturerModelName", "SequenceName", "PulseSequenceName", "ReceiveCoilName",
    "TransmitCoilName", "ImagedNucleus", "ConvolutionKernel", "FilterType", "RescaleType",
    "WindowCenterWidthExplanation", "DeidentificationMethod", "SeriesDescription", "ProtocolName",
    "PositionReferenceIndicator", "ContrastBolusRoute", "ProcessingFunction", "CodeValue",
    "CodingSchemeDesignator", "CodingSchemeVersion", "CodeMeaning", "ContextIdentifier", "MappingResource",
    "LossyImageCompressionMethod", "SpecificCharacterSet",
}


def _known(keywords: list[str]) -> set[str]:
    return {kw for kw in keywords if tag_for_keyword(kw) is not None}


BLANK = _known(BLANK_KEYWORDS)
REMOVE = _known(REMOVE_KEYWORDS)
UNKNOWN_KEYWORDS = sorted(set(BLANK_KEYWORDS + REMOVE_KEYWORDS) - BLANK - REMOVE)

DEIDENTIFICATION_METHOD = [
    f"sim-ingest {__version__}: PS3.15 E.1-1 Basic Profile subset",
    "Patient/physician/institution/device IDs removed or blanked",
    "All private attributes removed",
    "UIDs replaced via keyed HMAC map (2.25 root)",
    "Dates/times removed or blanked; overlays/curves removed",
    "Unknown public attributes removed",
    "Descriptors removed unless vocabulary-checked",
    "Pixel data NOT modified: burned-in text not removed",
    "Recognizable visual features NOT removed",
]


# ---------------------------------------------------------------------------
# Keyed UID map
# ---------------------------------------------------------------------------


class UidMapper:
    """Deterministic, keyed (HMAC-SHA256) UID replacement under the 2.25 (UUID) root.

    The same original UID always maps to the same new UID for a given key, so
    Study/Series/SOP Instance UIDs and references to them stay consistent across files
    and across runs. Without the key the mapping cannot be recomputed or reversed.
    """

    def __init__(self, key: bytes, existing: dict[str, str] | None = None):
        if len(key) < 16:
            raise ValueError("UID key must be at least 16 bytes")
        self._key = key
        self.map: dict[str, str] = dict(existing or {})

    def __call__(self, uid: str) -> str:
        uid = str(uid).strip().rstrip("\x00").strip()
        if not uid:
            return uid
        if uid in self.map:
            return self.map[uid]
        digest = bytearray(hmac.new(self._key, uid.encode("ascii", "replace"), hashlib.sha256).digest()[:16])
        digest[6] = (digest[6] & 0x0F) | 0x80  # UUID version 8 (custom)
        digest[8] = (digest[8] & 0x3F) | 0x80  # RFC 4122 variant
        new = "2.25." + str(int.from_bytes(bytes(digest), "big"))
        self.map[uid] = new
        return new


def load_or_create_key(path: Path) -> bytes:
    path = Path(path)
    if path.exists():
        key = path.read_bytes().strip()
        try:
            key = bytes.fromhex(key.decode("ascii"))
        except (UnicodeDecodeError, ValueError):
            pass
        if len(key) < 16:
            raise UnsupportedDicomError("UID key file is too short (need at least 16 bytes)")
        return key
    from ingest.util import write_private_bytes

    key = secrets.token_bytes(32)
    write_private_bytes(path, key.hex().encode("ascii") + b"\n")
    return key


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def supported_syntaxes_text() -> str:
    return ", ".join(f"{uid} ({name})" for uid, name in SUPPORTED_TRANSFER_SYNTAXES.items())


def transfer_syntax_of(ds: Dataset) -> str | None:
    meta = getattr(ds, "file_meta", None)
    ts = getattr(meta, "TransferSyntaxUID", None) if meta is not None else None
    if ts:
        return str(ts)
    enc = getattr(ds, "original_encoding", None)
    if enc == (True, True):
        return "1.2.840.10008.1.2"
    if enc == (False, True):
        return "1.2.840.10008.1.2.1"
    return None


def check_transfer_syntax(ds: Dataset, where: str = "") -> str:
    ts = transfer_syntax_of(ds)
    prefix = f"{where}: " if where else ""
    if ts is None:
        raise UnsupportedDicomError(
            f"{prefix}Unsupported transfer syntax: none declared and it could not be inferred. "
            f"Supported transfer syntaxes: {supported_syntaxes_text()}."
        )
    if ts not in SUPPORTED_TRANSFER_SYNTAXES:
        try:
            name = UID(ts).name
        except Exception:  # noqa: BLE001
            name = "unknown"
        raise UnsupportedDicomError(
            f"{prefix}Unsupported transfer syntax {ts} ({name}). This tool only reads uncompressed "
            f"little-endian DICOM: {supported_syntaxes_text()}. Compressed (JPEG, JPEG-LS, JPEG 2000, RLE, "
            f"HTJ2K, MPEG), deflated and big-endian transfer syntaxes are rejected, not decoded. Decompress "
            f"the quarantined copy with a trusted local tool (e.g. dcmtk 'dcmdjpeg' or 'gdcmconv --raw') and re-run."
        )
    return ts


def _num(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def validate_for_display(ds: Dataset, where: str = "", check_pixels: bool = False) -> list[str]:
    """Raise UnsupportedDicomError for objects the viewer cannot display; return notes."""
    prefix = f"{where}: " if where else ""
    notes: list[str] = []
    check_transfer_syntax(ds, where)
    pi = str(getattr(ds, "PhotometricInterpretation", "") or "").strip()
    if pi not in SUPPORTED_PHOTOMETRIC:
        raise UnsupportedDicomError(
            f"{prefix}Unsupported PhotometricInterpretation '{pi or 'missing'}'; supported: {', '.join(SUPPORTED_PHOTOMETRIC)}."
        )
    spp = int(getattr(ds, "SamplesPerPixel", 1) or 1)
    if (pi == "RGB") != (spp == 3):
        raise UnsupportedDicomError(f"{prefix}SamplesPerPixel {spp} is inconsistent with PhotometricInterpretation {pi}.")
    rows, cols = int(getattr(ds, "Rows", 0) or 0), int(getattr(ds, "Columns", 0) or 0)
    if rows <= 0 or cols <= 0:
        raise UnsupportedDicomError(f"{prefix}Rows/Columns missing or zero.")
    bits_alloc = int(getattr(ds, "BitsAllocated", 0) or 0)
    if bits_alloc not in (8, 16):
        raise UnsupportedDicomError(f"{prefix}BitsAllocated {bits_alloc} not supported (8 or 16 required).")
    bits_stored = int(getattr(ds, "BitsStored", bits_alloc) or bits_alloc)
    if bits_stored > bits_alloc:
        raise UnsupportedDicomError(f"{prefix}BitsStored {bits_stored} exceeds BitsAllocated {bits_alloc}.")
    if pi == "RGB" and bits_alloc != 8:
        raise UnsupportedDicomError(f"{prefix}RGB with BitsAllocated {bits_alloc} is not supported (8 required).")
    high_bit = getattr(ds, "HighBit", None)
    if high_bit is not None and int(high_bit) != bits_stored - 1:
        notes.append(f"HighBit {high_bit} is not BitsStored-1")
    if "FloatPixelData" in ds or "DoubleFloatPixelData" in ds:
        raise UnsupportedDicomError(f"{prefix}Float pixel data is not supported.")
    slope, intercept = getattr(ds, "RescaleSlope", None), getattr(ds, "RescaleIntercept", None)
    if slope is not None and (_num(slope) is None or _num(slope) == 0):
        raise UnsupportedDicomError(f"{prefix}RescaleSlope is not a usable number.")
    if intercept is not None and _num(intercept) is None:
        raise UnsupportedDicomError(f"{prefix}RescaleIntercept is not a number.")
    if slope is None and intercept is None:
        notes.append("RescaleSlope/RescaleIntercept absent; identity (1, 0) assumed")
    ps = getattr(ds, "PixelSpacing", None)
    if ps is not None:
        vals = [_num(v) for v in (ps if isinstance(ps, (list, MultiValue)) else [ps])]
        if len(vals) != 2 or any(v is None or v <= 0 for v in vals):
            notes.append("PixelSpacing present but invalid; measurements unavailable")
    else:
        notes.append("PixelSpacing absent; measurements unavailable")
    iop = getattr(ds, "ImageOrientationPatient", None)
    if iop is not None and (len(iop) != 6 or any(_num(v) is None for v in iop)):
        notes.append("ImageOrientationPatient present but invalid")
    if check_pixels:
        if "PixelData" not in ds:
            raise UnsupportedDicomError(f"{prefix}No PixelData element.")
        frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
        expected = rows * cols * spp * (bits_alloc // 8) * frames
        actual = len(ds.PixelData)
        if actual < expected:
            raise UnsupportedDicomError(
                f"{prefix}PixelData is shorter than Rows x Columns x Samples x Bytes x Frames ({actual} < {expected})."
            )
    return notes


# ---------------------------------------------------------------------------
# De-identification
# ---------------------------------------------------------------------------


def _value_present(elem) -> bool:
    v = elem.value
    if v is None:
        return False
    if elem.VR == "SQ":
        return len(v) > 0
    if isinstance(v, (bytes, bytearray)):
        return len(v) > 0
    return str(v).strip() != ""


def count_private(ds: Dataset) -> int:
    n = [0]

    def cb(_dataset, elem):
        if elem.tag.is_private:
            n[0] += 1

    ds.walk(cb)
    return n[0]


def deidentify(ds: Dataset, mapper: UidMapper) -> dict[str, Any]:
    """De-identify ``ds`` in place. Returns a report (attribute keywords only, no values)."""
    report: dict[str, Any] = {
        "removed": set(),
        "blanked": set(),
        "uidsReplaced": 0,
        "privateRemoved": count_private(ds),
        "datesRemoved": 0,
        "descriptorsKept": set(),
        "descriptorsRemoved": set(),
        "overlayElementsRemoved": 0,
        "unknownPublicRemoved": 0,
    }
    ds.remove_private_tags()
    for tag in list(ds.keys()):
        group = tag.group
        if (0x6000 <= group <= 0x60FF or 0x5000 <= group <= 0x50FF) and group % 2 == 0:
            del ds[tag]
            report["overlayElementsRemoved"] += 1

    def cb(dataset: Dataset, elem) -> None:
        tag = elem.tag
        if tag.element == 0x0000:  # stale group lengths
            del dataset[tag]
            return
        kw = elem.keyword
        if not kw and not tag.is_private:
            # public attribute unknown to the data dictionary: its content cannot be vouched for
            del dataset[tag]
            report["unknownPublicRemoved"] += 1
            return
        if kw in REMOVE:
            del dataset[tag]
            report["removed"].add(kw)
            return
        if kw in BLANK:
            if _value_present(elem):
                report["blanked"].add(kw)
            elem.value = [] if elem.VR == "SQ" else ""
            return
        if kw in CONDITIONAL_DESCRIPTORS:
            if _value_present(elem) and safe_descriptor(str(elem.value)):
                report["descriptorsKept"].add(kw)
            else:
                del dataset[tag]
                if _value_present(elem):
                    report["descriptorsRemoved"].add(kw)
            return
        if elem.VR in DATE_VRS:
            del dataset[tag]
            report["datesRemoved"] += 1
            return
        if elem.VR == "UI" and kw not in UID_KEEP_KEYWORDS and elem.value:
            if isinstance(elem.value, (list, MultiValue)):
                new_vals = []
                for v in elem.value:
                    if str(v).startswith(STANDARD_UID_ROOT):
                        new_vals.append(str(v))
                    else:
                        new_vals.append(mapper(str(v)))
                        report["uidsReplaced"] += 1
                elem.value = new_vals
            else:
                v = str(elem.value)
                if not v.startswith(STANDARD_UID_ROOT):
                    elem.value = mapper(v)
                    report["uidsReplaced"] += 1

    ds.walk(cb)
    ds.PatientIdentityRemoved = "YES"
    ds.DeidentificationMethod = list(DEIDENTIFICATION_METHOD)
    ds.LongitudinalTemporalInformationModified = "REMOVED"
    for key in ("removed", "blanked", "descriptorsKept", "descriptorsRemoved"):
        report[key] = sorted(report[key])
    return report


def _tag_label(elem) -> str:
    t = elem.tag
    return f"({t.group:04X},{t.element:04X}) {elem.keyword or 'unknown'}".strip()


def scan_deidentified(ds: Dataset, location: str, institutions: list[str] | tuple[str, ...] = ()) -> list[Finding]:
    """Residual-risk checks on a de-identified dataset (values are never reported)."""
    findings: list[Finding] = []

    def cb(_dataset, elem) -> None:
        if elem.tag.is_private:
            findings.append(Finding("high", location, f"private attribute {_tag_label(elem)} remains", "dicom_tag", "content"))
            return
        if elem.VR == "SQ":
            return
        kw = elem.keyword
        present = _value_present(elem)
        if kw in REMOVE and present:
            findings.append(Finding("high", location, f"identifying attribute {_tag_label(elem)} remains", "dicom_tag", "content"))
            return
        if kw in BLANK and present:
            findings.append(Finding("high", location, f"identifying attribute {_tag_label(elem)} not blank", "dicom_tag", "content"))
            return
        if not present:
            return
        if elem.VR == "PN":
            findings.append(Finding("high", location, f"person name remains in {_tag_label(elem)}", "dicom_tag", "content"))
            return
        if elem.VR in DATE_VRS:
            findings.append(Finding("medium", location, f"date/time value remains in {_tag_label(elem)}", "dicom_tag", "content"))
            return
        if elem.VR in TEXT_VRS:
            text = "\\".join(str(v) for v in elem.value) if isinstance(elem.value, (list, MultiValue)) else str(elem.value)
            if kw in SAFE_TEXT_KEYWORDS:
                if kw in CONDITIONAL_DESCRIPTORS:
                    findings.append(
                        Finding("low", location, f"descriptor {_tag_label(elem)} retained (every token is an acquisition term)", "dicom_tag", "content")
                    )
                elif has_identifier_like(text, institutions):
                    findings.append(
                        Finding("high", location, f"identifier-like text in {_tag_label(elem)}", "dicom_tag", "content")
                    )
                return
            hits = scan_text(text, location, institutions=institutions, scope="content", category="dicom_tag", what=_tag_label(elem))
            for h in hits:
                if h.severity != "low":
                    h.severity = "high"
            findings.extend(hits)
            findings.append(
                Finding(
                    "medium",
                    location,
                    f"free-text attribute {_tag_label(elem)} still contains text ({len(text)} characters): review",
                    "dicom_tag",
                    "content",
                )
            )

    ds.walk(cb)
    findings.extend(pixel_risk_findings(ds, location))
    return findings


def pixel_risk_findings(ds: Dataset, location: str) -> list[Finding]:
    out = []
    burned = str(getattr(ds, "BurnedInAnnotation", "") or "").upper()
    if burned == "YES":
        out.append(
            Finding(
                "high",
                location,
                "BurnedInAnnotation=YES: pixel data contains burned-in text that this tool does not remove",
                "dicom_burned_in",
                "content",
            )
        )
    elif not burned:
        modality = str(getattr(ds, "Modality", "") or "").upper()
        image_type = [str(v).upper() for v in (getattr(ds, "ImageType", []) or [])]
        if modality in ("US", "SC", "OT", "XC", "DOC", "ES") or "SECONDARY" in image_type:
            out.append(
                Finding(
                    "medium",
                    location,
                    "BurnedInAnnotation not stated for a modality/image type that often carries burned-in text (screen capture, ultrasound)",
                    "dicom_burned_in",
                    "content",
                )
            )
    if str(getattr(ds, "RecognizableVisualFeatures", "") or "").upper() == "YES":
        out.append(
            Finding("high", location, "RecognizableVisualFeatures=YES (e.g. face/photograph)", "recognizable_features", "content")
        )
    return out


def source_value_findings(ds: Dataset, location: str, institutions: list[str] | tuple[str, ...] = ()) -> list[Finding]:
    """Identifier patterns in the source's text-valued attributes (values never reported).

    Attributes that de-identification removes/blanks get scope ``source_only``; attributes
    that are retained get scope ``content`` (they are re-checked after de-identification).
    """
    out: list[Finding] = []

    def cb(_dataset, elem) -> None:
        if elem.tag.is_private or elem.VR not in TEXT_VRS or not _value_present(elem):
            return
        kw = elem.keyword
        text = "\\".join(str(v) for v in elem.value) if isinstance(elem.value, (list, MultiValue)) else str(elem.value)
        removed = kw in REMOVE or kw in BLANK or elem.VR == "PN" or (kw in CONDITIONAL_DESCRIPTORS and not safe_descriptor(text))
        out.extend(
            scan_text(
                text,
                location,
                institutions=institutions,
                scope="source_only" if removed else "content",
                category="dicom_tag",
                what=f"DICOM {_tag_label(elem)}" + (" (removed/blanked by extract)" if removed else ""),
            )
        )

    ds.walk(cb)
    return out


def source_phi_findings(ds: Dataset, location: str) -> list[Finding]:
    """What a source instance carries before de-identification (keywords only, no values)."""
    present = set()

    def cb(_dataset, elem) -> None:
        if elem.tag.is_private:
            return
        kw = elem.keyword
        if (kw in REMOVE or kw in BLANK or elem.VR == "PN") and _value_present(elem):
            present.add(kw or _tag_label(elem))

    ds.walk(cb)
    out = []
    if present:
        names = ", ".join(sorted(present)[:12]) + (" ..." if len(present) > 12 else "")
        out.append(
            Finding(
                "high",
                location,
                f"identifying DICOM attributes present in the source ({names}); removed/blanked by extract",
                "dicom_tag",
                "source_only",
            )
        )
    n_private = count_private(ds)
    if n_private:
        out.append(
            Finding("medium", location, f"{n_private} private attribute(s) present in the source; removed by extract", "dicom_tag", "source_only")
        )
    return out
