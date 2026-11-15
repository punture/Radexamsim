"""Optional commercial-rights map (owner-maintained CSV).

Commercial permission is SEPARATE from de-identification: a source can be fully
de-identified and still have unresolved rights, and vice versa.

CSV format (header row required)::

    match,commercialUseStatus,note
    3f9a2b1c4d5e6f70,cleared,own case
    lectures/2019/*.pptx,restricted,journal figures
    *,unresolved,

``match`` is either a SHA-256 / sourceFileId prefix (8+ hex characters) or a glob over the
source's relative path inside SRC_DIR. When several rows match, the most restrictive
status wins (restricted > unresolved > cleared). Paths and notes are read locally and are
never written to any output.
"""

from __future__ import annotations

import csv
import fnmatch
import re
from pathlib import Path

from ingest.model import SourceFile
from ingest.util import IngestError

STATUSES = ("cleared", "unresolved", "restricted")
RESTRICTIVENESS = {"cleared": 0, "unresolved": 1, "restricted": 2}
HEX_RE = re.compile(r"^[0-9a-fA-F]{8,64}$")


def load_rights_map(path: Path | None) -> list[tuple[str, str]]:
    if path is None:
        return []
    rules: list[tuple[str, str]] = []
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            fields = {(name or "").strip().lower(): name for name in (reader.fieldnames or [])}
            match_col = fields.get("match") or fields.get("sha256") or fields.get("sourcefileid") or fields.get("path")
            status_col = fields.get("commercialusestatus") or fields.get("status")
            if not match_col or not status_col:
                raise IngestError("rights map needs a header with 'match' and 'commercialUseStatus' columns")
            for line_no, row in enumerate(reader, start=2):
                match = (row.get(match_col) or "").strip()
                status = (row.get(status_col) or "").strip().lower()
                if not match and not status:
                    continue
                if status not in STATUSES:
                    raise IngestError(f"rights map line {line_no}: status must be one of {', '.join(STATUSES)}")
                if not match:
                    raise IngestError(f"rights map line {line_no}: empty match")
                rules.append((match, status))
    except OSError as exc:
        raise IngestError(f"rights map could not be read ({type(exc).__name__})") from exc
    return rules


def status_for(src: SourceFile, rules: list[tuple[str, str]]) -> str | None:
    matched: list[str] = []
    paths = src.rels or [src.rel]
    for match, status in rules:
        if HEX_RE.match(match):
            if src.sha256.startswith(match.lower()):
                matched.append(status)
            continue
        pattern = match.replace("\\", "/")
        if any(fnmatch.fnmatchcase(p, pattern) or fnmatch.fnmatchcase(p.rsplit("/", 1)[-1], pattern) for p in paths):
            matched.append(status)
    if not matched:
        return None
    return max(matched, key=lambda s: RESTRICTIVENESS[s])


def combine(statuses: list[str]) -> str:
    """Most restrictive of several statuses (used for multi-file DICOM series)."""
    if not statuses:
        return "unresolved"
    return max(statuses, key=lambda s: RESTRICTIVENESS[s])
