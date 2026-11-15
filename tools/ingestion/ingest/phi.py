"""Identifier pattern checks over text (slide text, notes, PDF text, metadata, DICOM values).

These checks HELP the owner find identifiers; they do not prove de-identification.
Findings never contain the matched value itself, only what kind of pattern matched.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ingest.model import Finding

_MONTHS = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
DATE_PATTERN = (
    r"(?:"
    r"(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])"  # 2019-01-31
    r"|(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)?\d{2}"  # 31/01/2019
    r"|(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:19|20)?\d{2}"  # 01/31/2019
    r"|(?:0?[1-9]|[12]\d|3[01])[\s-]?" + _MONTHS + r"[\s,-]*(?:19|20)?\d{2}"  # 31 Jan 2019
    r"|" + _MONTHS + r"\s+(?:0?[1-9]|[12]\d|3[01]),?\s+(?:19|20)\d{2}"  # Jan 31, 2019
    r"|(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])"  # 20190131
    r")"
)


@dataclass(frozen=True)
class Pattern:
    pid: str
    severity: str
    description: str
    regex: re.Pattern[str]
    priority: int  # higher wins when matches overlap


PATTERNS: list[Pattern] = [
    Pattern(
        "name_label",
        "high",
        "name label followed by a value (e.g. 'Name:')",
        re.compile(
            r"\b(?:patient(?:'s)?\s*name|pt\.?\s*name|full\s*name|surname|first\s*name|last\s*name|"
            r"given\s*name|family\s*name|name)\s*[:=]\s*[A-Za-z]",
            re.I,
        ),
        90,
    ),
    Pattern(
        "dob_label",
        "high",
        "date-of-birth label with a date",
        re.compile(
            r"\b(?:DOB|D\.O\.B\.?|date\s*of\s*birth|birth\s*date|birthdate|born(?:\s*on)?)\s*[:=]?\s*"
            + DATE_PATTERN,
            re.I,
        ),
        95,
    ),
    Pattern(
        "dob_label_bare",
        "high",
        "date-of-birth label",
        re.compile(r"\b(?:DOB|D\.O\.B\.?|date\s*of\s*birth)\s*[:=]", re.I),
        85,
    ),
    Pattern(
        "mrn_label",
        "high",
        "MRN / health-card / patient-ID label with a number",
        re.compile(
            r"\b(?:MRN|MR\s*#|MR\s*No\.?|med(?:ical)?\s*rec(?:ord)?s?\s*(?:no\.?|number|#)?|"
            r"chart\s*(?:no\.?|number|#)|hospital\s*(?:no\.?|number|#)|patient\s*(?:id|no\.?|number|#)|"
            r"pt\s*(?:id|#)|health\s*card(?:\s*(?:no\.?|number|#))?|HCN|OHIP|NHS\s*(?:no\.?|number)?|PHN|"
            r"SSN|SIN|insurance\s*(?:no\.?|number|#))\b\.?\s*[:#=]?\s*[A-Z]{0,3}[-\s]?\d{4,}",
            re.I,
        ),
        92,
    ),
    Pattern(
        "accession_label",
        "high",
        "accession-number label with a value",
        re.compile(
            r"\b(?:accession|acc)\b\.?(?:\s*(?:no\.?|number|#))?\s*[:#=]?\s*(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,}",
            re.I,
        ),
        91,
    ),
    Pattern(
        "grouped_number",
        "medium",
        "phone / health-card / SSN-like grouped number",
        re.compile(
            r"(?<![\d-])(?:\+?1[-.\s]?)?(?:\(\d{3}\)\s?|\d{3,4}[-.\s])\d{3}[-.\s]\d{3,4}(?![\d-])"
            r"|(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])"
        ),
        60,
    ),
    Pattern(
        "long_number",
        "medium",
        "MRN/health-card-like 6-12 digit number",
        re.compile(r"(?<![\d.,])\d{6,12}(?![\d.,])"),
        55,
    ),
    Pattern(
        "accession_like",
        "medium",
        "accession-like alphanumeric identifier",
        re.compile(r"\b[A-Z]{1,4}-?\d{6,10}\b"),
        58,
    ),
    Pattern(
        "date",
        "medium",
        "date-like value (dates linked to a patient are identifiers)",
        re.compile(r"(?<!\d)" + DATE_PATTERN + r"(?!\d)", re.I),
        57,
    ),
    Pattern(
        "email",
        "medium",
        "e-mail address",
        re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        70,
    ),
    Pattern(
        "postal_code",
        "medium",
        "postal-code-like value",
        re.compile(r"\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b|\b\d{5}-\d{4}\b"),
        45,
    ),
    Pattern(
        "age_over_89",
        "medium",
        "age over 89 (an identifier under HIPAA)",
        re.compile(r"\b(?:9\d|1[01]\d)[\s-]*(?:y/?o|yo|yrs?|years?)\b(?:[\s-]*old)?", re.I),
        40,
    ),
    Pattern(
        "honorific_name",
        "medium",
        "honorific followed by a capitalised name (e.g. 'Mrs X')",
        re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Mx)\.?\s+[A-Z][a-z]+"),
        65,
    ),
    Pattern(
        "doctor_name",
        "low",
        "clinician name (e.g. 'Dr X')",
        re.compile(r"\bDr\.?\s+[A-Z][a-z]+"),
        30,
    ),
    Pattern(
        "institution_like",
        "low",
        "institution-like name (hospital/clinic)",
        re.compile(
            r"\b[A-Z][A-Za-z.'&-]+(?:\s+[A-Z][A-Za-z.'&-]+){0,4}\s+"
            r"(?:Hospital|Medical\s+Cent(?:er|re)|Health\s+Cent(?:er|re)|Health\s+Sciences\s+Cent(?:er|re)|"
            r"Clinic|Infirmary|Health\s+System|Healthcare)\b"
        ),
        35,
    ),
]

PATTERN_BY_ID = {p.pid: p for p in PATTERNS}


def load_institutions(path: Path | None) -> list[str]:
    """Load a configurable list of institution names (one per line, '#' comments allowed)."""
    if path is None:
        return []
    names = []
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        from ingest.util import IngestError

        raise IngestError(f"institutions file could not be read ({type(exc).__name__})") from exc
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            names.append(line)
    return names


def _institution_regexes(institutions: list[str] | tuple[str, ...]) -> list[re.Pattern[str]]:
    out = []
    for name in institutions:
        words = [re.escape(w) for w in name.split()]
        if words:
            out.append(re.compile(r"\b" + r"\s+".join(words) + r"\b", re.I))
    return out


def find_matches(text: str, institutions: list[str] | tuple[str, ...] = ()) -> list[tuple[Pattern, int, int]]:
    """All non-overlapping pattern matches, preferring higher-priority patterns."""
    if not text:
        return []
    candidates: list[tuple[Pattern, int, int]] = []
    for pat in PATTERNS:
        for m in pat.regex.finditer(text):
            candidates.append((pat, m.start(), m.end()))
    inst_pat = Pattern("institution_configured", "medium", "configured institution name", re.compile("x"), 80)
    for rx in _institution_regexes(institutions):
        for m in rx.finditer(text):
            candidates.append((inst_pat, m.start(), m.end()))
    candidates.sort(key=lambda c: (-c[0].priority, c[1]))
    kept: list[tuple[Pattern, int, int]] = []
    for pat, s, e in candidates:
        if any(not (e <= ks or s >= ke) for _, ks, ke in kept):
            continue
        kept.append((pat, s, e))
    kept.sort(key=lambda c: c[1])
    return kept


def scan_text(
    text: str,
    location: str,
    *,
    institutions: list[str] | tuple[str, ...] = (),
    scope: str = "source_text",
    category: str = "text",
    what: str = "text",
) -> list[Finding]:
    """Return one finding per matched pattern kind (with a count), never the matched value."""
    counts: dict[str, tuple[Pattern, int]] = {}
    for pat, _s, _e in find_matches(text, institutions):
        prev = counts.get(pat.pid)
        counts[pat.pid] = (pat, (prev[1] if prev else 0) + 1)
    findings = []
    for pat, n in counts.values():
        suffix = f" ({n} occurrences)" if n > 1 else ""
        findings.append(
            Finding(
                severity=pat.severity,
                location=location,
                finding=f"{pat.description} in {what}{suffix}",
                category=category,
                scope=scope,
            )
        )
    return findings


def has_identifier_like(text: str, institutions: list[str] | tuple[str, ...] = (), min_severity: str = "medium") -> bool:
    order = {"low": 1, "medium": 2, "high": 3}
    return any(order[p.severity] >= order[min_severity] for p, _, _ in find_matches(text, institutions))


# ---------------------------------------------------------------------------
# Vocabulary-checked descriptors (safe to show because every token is a known
# acquisition term). Anything else is withheld.
# ---------------------------------------------------------------------------

SAFE_DESCRIPTOR_TOKENS = set(
    """
    ax axi axial sag sagittal cor coronal obl oblique tra tran trans transverse
    t1 t2 t1w t2w t1wi t2wi pd pdw flair dwi dti adc trace swi swan gre t2star mprage spgr bravo fspgr
    tse fse se ir stir fiesta ciss space cube vibe lava tof mra mrv cta ctv ctp pc phase contrast venous
    arterial perfusion dsc dce asl cbf cbv mtt tmax ttp fa md tractography pre post gad gd gado c
    wo w with without fs fatsat fat sat water in out opp dixon 3d 2d mip minip mpr vr recon reformat
    thin thick bone brain soft tissue lung head neck spine cervical thoracic lumbar cspine tspine lspine
    orbit orbits sinus sinuses iac temporal pituitary sella angio angiogram run frontal lateral ap pa lat
    left right lt rt l r bilateral early late delayed high hr res resolution localizer scout survey loc
    std standard sharp smooth window routine non nc noncon enhanced unenhanced map maps sub subtraction
    dsa mask native roadmap cine dynamic iso isotropic hd fast echo spin gradient inversion recovery
    diffusion weighted susceptibility vessel vessels carotid circle willis cow intracranial
    neuro img image images series cs mpg plain axials sagittals coronals bold fmri sv mv mp rage
    frfse propeller blade arc hyperband sms
    """.split()
)

_NUMERIC_TOKEN = re.compile(r"^(?:\d{1,4}(?:\.\d+)?(?:mm|ms|s|t)?|b\d{1,4}|x\d{1,2}|\d{1,2}x\d{1,2})$")


def safe_descriptor(text: str | None, max_len: int = 64) -> str | None:
    """Return ``text`` normalised if every token is in the acquisition vocabulary, else None."""
    if not text:
        return None
    text = " ".join(str(text).split())
    if not text or len(text) > max_len:
        return None
    tokens = [t for t in re.split(r"[\s_/,+()\-.:;*\\]+", text.lower()) if t]
    if not tokens:
        return None
    for tok in tokens:
        if tok in SAFE_DESCRIPTOR_TOKENS or _NUMERIC_TOKEN.match(tok):
            continue
        return None
    if has_identifier_like(text, min_severity="medium"):
        return None
    return text
