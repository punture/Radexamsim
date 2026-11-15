"""Identifier pattern checks: flagged, and the matched value never appears in the finding."""

from ingest.phi import has_identifier_like, safe_descriptor, scan_text


def kinds(findings):
    return {(f.severity, f.finding.split(" in ")[0]) for f in findings}


def test_name_and_mrn_flagged_high_without_values():
    findings = scan_text("Name: Test Person, MRN 12345678", "slide 1 text")
    sev = {f.finding.split(" in ")[0]: f.severity for f in findings}
    assert sev["name label followed by a value (e.g. 'Name:')"] == "high"
    assert sev["MRN / health-card / patient-ID label with a number"] == "high"
    for f in findings:
        assert "Test" not in f.finding and "Person" not in f.finding and "12345678" not in f.finding
        assert f.location == "slide 1 text"


def test_dob_accession_and_dates():
    assert ("high", "date-of-birth label with a date") in kinds(scan_text("DOB: 1970-01-02", "x"))
    assert ("high", "accession-number label with a value") in kinds(scan_text("Accession: AB123456", "x"))
    assert ("high", "accession-number label with a value") in kinds(scan_text("acc# 99887766", "x"))
    found = kinds(scan_text("seen 2019-03-04 and 31 Jan 2019", "x"))
    assert ("medium", "date-like value (dates linked to a patient are identifiers)") in found


def test_bare_numbers_and_configured_institution():
    found = kinds(scan_text("ref 004512378 at Example General Hospital", "x", institutions=["Example General Hospital"]))
    assert ("medium", "MRN/health-card-like 6-12 digit number") in found
    assert ("medium", "configured institution name") in found


def test_no_false_positive_on_plain_teaching_text():
    assert scan_text("Ring-enhancing lesion with restricted diffusion; accuracy is high.", "x") == []
    assert not has_identifier_like("T2 FLAIR axial 5 mm")


def test_vocabulary_checked_descriptors():
    assert safe_descriptor("AX T2 FLAIR") == "AX T2 FLAIR"
    assert safe_descriptor("Sag T1 MPRAGE C+") == "Sag T1 MPRAGE C+"
    assert safe_descriptor("AX T2 Jane") is None
    assert safe_descriptor("Dr Smith brain protocol") is None
